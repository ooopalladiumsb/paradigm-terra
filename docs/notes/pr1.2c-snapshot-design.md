# PR-1.2c — Snapshot + Tail Replay design review (before code)

**Date:** 2026-06-07 · Branch `post-freeze/pr1` · Fixes the snapshot/recovery contract **before**
PR-1.2c code, the way PP#2-A.5 fixed the envelope rules before the live build. Operations layer,
**above the Freeze Surface** (composes the frozen validator/reducer/canonical; changes none). Builds on
PR-1.2b's `IncrementalState` (`600d727`) — the formal process-state object that did not exist when
PR-1.2a was written, and whose serialisability is already shown by the Gate-1 split/resume test.

## The one wall left

PR-1.2b removed the runtime O(n)/tick wall (incremental `applyTick`; daemon drift ~11 s → 71 ms). The
remaining known operational wall is **cold recovery**: `OvtNode.open()` still re-folds the whole WAL
from genesis — ~7.9 s / 400 ticks here, ~2 h / 1M at scale (OVT-SG). PR-1.2c closes it so

```
recover  =  restore(latest valid snapshot)  +  replay_tail(WAL after covered_tick)
```

turning hours into "load one state + replay a short tail." It must do so without becoming a second
source of truth for the frozen core — hence the three rules below come first.

## The state object a snapshot persists

A snapshot is exactly a serialised `IncrementalState` plus the metadata to validate it:

```
IncrementalState                        snapshot envelope
 ├─ state            (reducer State)     ├─ snapshot_version
 ├─ currentTick      (bigint)            ├─ covered_tick   = WAL tick index folded THROUGH (incl.)
 ├─ eventCount       (number)            ├─ state_root     (redundant, for a fast integrity check)
 └─ lastEventHash    (Uint8Array)        ├─ event_log_root (redundant, CE §6.3)
                                         └─ checksum       (over the canonical snapshot bytes)
```

Restore = decode the `IncrementalState`, then `applyTick`-fold the WAL tail (ticks after
`covered_tick`) onto it — the same `applyTick` the hot path and the full re-fold use (single fold
logic, PR-1.2b).

**Format note (concrete, easy to get wrong):** `OvtNode`'s existing `enc/dec` codec handles `bigint`
(the `$bigint` tag) but **not `Uint8Array`** — `lastEventHash` is bytes. The split/resume test passed
only because `structuredClone` preserves `Uint8Array` natively; **disk JSON does not**. The snapshot
codec must explicitly encode `lastEventHash` (e.g. a `$bytes`-hex tag), or store/rehydrate it as hex.
This is a Gate condition for PR-1.2c-A, not a footnote.

---

## Rule 1 — Snapshot Truth Rule

```
WAL       = source of truth   (the ordered submission inputs; the only commit authority)
Snapshot  = recovery accelerator (a discardable cache of a derived fold)
```

Never `snapshot → canonical truth`. Always `snapshot + tail WAL → truth`. Consequence: a missing,
older, corrupt, or unreadable snapshot can **always** be dropped and the state rebuilt by the full
WAL re-fold (the OVT-2 path, which always works). A snapshot can therefore never cause data loss or
divergence — at worst it costs a full re-fold. This is the property that makes PR-1.2c safe to add
above a frozen core; it is the same Decision A as PR-1.2a §1, now made operational.

## Rule 2 — Recovery Equivalence Rule

For any committed WAL:

```
full_replay(WAL)  ==  restore(snapshot) + replay_tail(WAL after covered_tick)
```

byte-for-byte on **all four** carried quantities — a partial match is a defect:

```
STATE_ROOT        global_merkle_root        eventCount        lastEventHash
```

(STATE_ROOT alone is insufficient: the PR-1.2b negative control showed `STATE_ROOT` can match while
`lastEventHash` diverges. All four, or it fails.) This generalises OVT-2's `crash → replay → same
STATE_ROOT` to the snapshot path; it is the guard that the accelerator introduces **zero** divergence.
The PR-1.2c-B test asserts it over the OVT corpus at every possible `covered_tick` split (the snapshot
analogue of PR-1.2b's split/resume).

## Rule 3 — Snapshot Atomicity Rule

Write ordering — the WAL commit point is preserved and the snapshot is strictly secondary:

```
commit path (per tick):           snapshot path (off the latency-critical path, periodic):
  1. append tick to WAL             S1. write snapshot → snapshot.tmp
  2. fsync WAL   ← COMMIT POINT     S2. fsync snapshot.tmp
  3. apply to liveState (memory)    S3. rename(snapshot.tmp, snapshot-<covered_tick>)  ← atomic publish
```

The single invariant that must never be violated:

```
covered_tick(any published snapshot)  ≤  last committed WAL tick
```

i.e. **no snapshot may be newer than the durable WAL.** It holds by construction: a snapshot's
`covered_tick` only ever names ticks already fsync'd to the WAL (step 2 precedes step 3), and the
rename is atomic, so a crash never publishes a partial or ahead-of-WAL snapshot. A snapshot is
**valid for recovery only if** `covered_tick ≤ last committed WAL tick` **and** its checksum verifies;
otherwise it is dropped (Rule 1). Retain **≥ 2** snapshots so an unreadable latest falls back to the
previous; if none is valid, the full WAL re-fold always recovers.

---

## Crash matrix (the PR-1.2c-C test — the readiness gate of 1.2c)

Every crash point must recover to the same `full_replay(WAL)` result (Rule 2). `T` = the WAL's last
durable tick after the crash; `C` = covered_tick of the newest valid snapshot.

| # | Crash point | On-disk situation | Recovery action | Invariant |
|---|---|---|---|---|
| 1 | before any snapshot | WAL only | full re-fold (= restore none + replay all) | Rule 1 |
| 2 | mid snapshot write (S1) | partial `.tmp`, no published snapshot | ignore `.tmp`; prev snapshot or full re-fold | Rule 3 |
| 3 | after fsync tmp, before rename (S2→S3) | complete `.tmp`, not published | ignore `.tmp` (unpublished); prev/full | Rule 3 |
| 4 | after rename (S3), before next WAL append | snapshot at `C`, `C == T` | restore(C) + empty tail | C ≤ T |
| 5 | after WAL append+fsync, before next snapshot | snapshot at `C`, `C < T` | restore(C) + replay tail (C, T] | C ≤ T |
| 6 | mid WAL append (torn line) | torn trailing WAL line | drop torn line (OVT-2) → surviving `T'`; `C ≤ T'` | Rule 3 + OVT-2 |

Forbidden state — must be **unreachable**, and the test asserts it never occurs:

```
a published snapshot with covered_tick > last committed WAL tick   (snapshot newer than WAL)
```

## Sub-stages

```
PR-1.2c-A  Snapshot format      — serialise/deserialise IncrementalState (incl. lastEventHash bytes)
                                   + envelope {version, covered_tick, roots, checksum}; round-trip test
                                   (decode∘encode == identity on all four carried quantities).
PR-1.2c-B  Tail replay          — restore(snapshot)+replay_tail == full_replay over the OVT corpus at
                                   every covered_tick split (Rule 2, byte-for-byte). Wire OvtNode.open()
                                   to take the snapshot path when a valid snapshot exists; cadence
                                   (every N ticks + on graceful shutdown, keep ≥2) per PR-1.2a §3.
PR-1.2c-C  Crash matrix         — the six rows above, each asserting recovery == full_replay, plus the
                                   forbidden-state assertion. Generalises OVT-2's crash→replay test.
```

Then **PR-1.3** pins the recovery SLA (target re-fold of the tail ≪ SLA at ≥1M CALs), and **PR-1.1b**
wires daemon crash/restart against this FINAL recovery pipeline (snapshot+tail), not an intermediate
one — which is why 1.1b sits after 1.2c.

## Risk-map position (after this stage)

```
Freeze Surface       ✅      Publication Layer    ✅      Integration Reality  ✅
Runtime Scalability  ✅ (PR-1.2b)                 Cold Recovery        ◀ PR-1.2c closes
```

## Related
- `pr1.2-architecture-review.md` — PR-1.2a (Runtime State Architecture) + the PR-1.2b DONE note;
  §1 (WAL=truth), §3 (cadence), §4 (write ordering), §5 (recovery proof) are the parents of Rules 1–3.
- `orchestrator/src/node/persistent-node.ts` — `OvtNode` (WAL + `foldFromGenesis` + the `enc/dec`
  codec the snapshot format extends) and `open()` (the cold-recovery path 1.2c-B rewires).
- `orchestrator/src/node.ts` — `IncrementalState` / `applyTick` (the object a snapshot persists and the
  fold tail replay reuses).
- `operational-validation-track.md` — OVT-2 (crash→replay) + OVT-SG (the ~2 h/1M recovery bound 1.2c closes).
