# PR-1.2a — Runtime State Architecture review (before code)

**Date:** 2026-06-07 · Branch `post-freeze/pr1` · A short design review that fixes the storage/recovery
contract **before** PR-1.2 code. Operations layer, **above the Freeze Surface** (composes the frozen
validator/reducer/canonical; changes none).

## Why this is bigger than "checkpointing"

PR-1.1's first operational profile changed the problem. Before: only *cold recovery* was O(history)
(~2 h/1M, snapshots needed). After: **runtime is O(history) too** — `OvtNode.submit()` re-folds the
whole WAL from genesis every tick, so per-tick latency hit ~465/812 ms against a 200 ms interval and
drift blew to ~11 s. The runtime wall is *worse* than the recovery wall: it destroys the process
itself. So PR-1.2 is not a checkpoint add-on; it is **Runtime State Architecture v1** — define live
state, snapshot semantics, and the recovery contract first.

## 1. Source of truth — **Decision: A (WAL = truth; State & Snapshot = cache)**

| | A (chosen) | B (rejected) |
|---|---|---|
| | WAL = truth · State = cache · Snapshot = cache | Snapshot = truth · tail WAL = delta |

The whole system already treats the **ordered submission WAL as the inputs** and State as a *derived*
fold (`run()` is pure; determinism is proven; the event log is derived output, replayable). Keep that:
the snapshot is a **discardable accelerator** — a corrupt/missing/older snapshot can always be dropped
and the State rebuilt from the WAL (the OVT-2 path, which always works). B would make the snapshot a
consensus-critical artifact needing its own integrity guarantees and risking silent divergence —
rejected. **Consequence:** snapshots can never cause data loss or divergence; at worst they cost a
full re-fold. This is the property that makes PR-1.2 safe to add above a frozen core.

## 2. Live state & the incremental-apply API — **Decision: the node maintains `liveState`**

Today `run()` discards the evolved `State` (returns only `finalStateRoot` + `eventLog`), forcing a
re-fold each tick. PR-1.2b introduces an official seam:

```
boot:     liveState = recover()                       // snapshot+tail, or full WAL re-fold
submit(b): { liveState, tickResult } = applyTick(liveState, b)   // O(submissions in b), NOT O(history)
```

`applyTick(state, block) → { state, tickResult }` is extracted from `run()`'s per-tick body
(tick.advanced when advancing + per-submission ingress/validate/apply) — it **composes** the frozen
validator+reducer, adds no consensus. `liveState` must also carry the **cumulative** `event_count` +
`last_event_hash`, because the CE §6.3 global Merkle root uses `lastSeqno = cumulative log length`;
without them the post-recovery global root would not continue correctly. (`STATE_ROOT` itself is a
pure function of State, so it needs nothing extra.)

## 3. Snapshot cadence — **Decision: every N committed ticks + on graceful shutdown; keep ≥2**

Recovery cost is bounded by the **tail length** (events since the last snapshot), so cadence is set by
the PR-1.3 recovery SLA: choose N so re-folding N ticks ≪ SLA (default N = 1000 ticks, tunable; a WAL-
bytes guard as a secondary trigger). Always snapshot on graceful shutdown (instant restart). Retain
≥2 snapshots (roll back to the previous if the latest is unreadable). Snapshots are taken **off the
commit path** (see §4) so they never add tick latency.

## 4. Crash consistency / write ordering — **the most important decision**

Preserve OVT-2's write-ahead commit point and make snapshots strictly secondary:

```
per tick (commit path):
  1. append tick block to WAL
  2. fsync WAL                     ← COMMIT POINT: a tick is committed iff its WAL line is durable
  3. apply to liveState (memory)   ← write-ahead: durable before applied
snapshot (off path, async/periodic):
  S1. write snapshot to TMP file (state + head{tick,state_root,event_count,last_event_hash} +
      covered_tick + snapshot_version + checksum)
  S2. fsync TMP
  S3. atomic rename TMP → snapshot-<covered_tick>   ← atomic publish; a crash before rename leaves no
                                                       partial snapshot (TMP is ignored on recovery)
```

Rules: (a) the WAL is the only commit authority; (b) a snapshot is **valid for recovery only if**
`covered_tick ≤ last committed WAL tick` and its checksum verifies; (c) a crash at *any* point leaves
the WAL prefix intact and at worst an ignorable TMP snapshot → recovery always succeeds. So snapshots
are **append-only, atomic, and idempotent**, and never on the latency-critical path.

## 5. Recovery proof — the central PR-1.2 invariant (the PR-1.2c test)

```
recover(latest valid snapshot + WAL tail)   ==   recover(full WAL from genesis)
```
identical `STATE_ROOT` **and** global event-log root. Plus the crash variants: a torn WAL tail, and a
crash mid-snapshot (TMP discarded) → both still equal the full re-fold. This generalizes OVT-2's
`crash → replay → same STATE_ROOT` to the snapshot path; it is the guard that the accelerator (§1)
introduces zero divergence. **Second invariant (PR-1.2b):** `applyTick`-folded incrementally ==
`run()` over the whole program (same event log + every root) — guards that incremental apply is
byte-identical to the proven batch fold.

## Re-ordered sub-stages (review changes the order)

```
PR-1.2a  Architecture Review            ◀ this doc
PR-1.2b  incremental live state         — extract applyTick; node holds liveState; runtime O(1)/tick.
                                          Gate: applyTick-fold == run(); re-run the daemon profile →
                                          per-tick latency flat (the ~465/812ms wall removed).
PR-1.2c  snapshot + tail replay         — §4 ordering; §5 recovery-proof test; cold recovery ≪ SLA.
PR-1.1b  daemon crash/restart           — wired against the FINAL recovery pipeline (snapshot+tail),
                                          not an intermediate one (why 1.1b moved after 1.2).
```

### PR-1.2b — DONE (2026-06-07): incremental live state, the O(n)/tick wall removed

`run()`'s per-tick body is extracted into a pure `applyTick(incr, block) → { next, tickResult,
events }` (`orchestrator/src/node.ts`); `run()` is now its left fold (single source of fold logic, no
duplication). The carried `IncrementalState = { state, currentTick, eventCount, lastEventHash }` makes
the CE §6.3 `(eventCount, lastEventHash)` ride in the **same** result that produced `state` —
`globalMerkleRoot` is rebuilt from those scalars, not from a full log array, so no daemon-side counter
can drift (the §2 concern). `OvtNode.submit()` advances the carried live state by one tick via
`applyTick` instead of `run(allTicks)` — the O(n)/tick re-fold is gone from the hot path; full re-folds
survive only in `open()` (cold recovery) and `bulkCreate()` (batch).

**Gate 1 (equivalence, the central post-freeze invariant) ✅** — `test/incremental-equivalence.test.ts`
over the whole OVT corpus (golden classes + a synthetic long program), with two non-tautological
oracles: carried-scalar global root == root recomputed from the materialised log; and split/resume
through `structuredClone(incr)` == whole-program batch. A negative control (inject a carry bug) trips
the right subtests. NORMATIVE golden + replay-determinism unchanged (`golden-vectors.test.ts` green).

**Gate 2 (wired path) ✅** — `test/incremental-node.test.ts`: a node built via `submit()` == one built
via `bulkCreate()` == `run()` byte-for-byte; plus a flat-marginal-cost sentinel against re-fold
regression.

**Gate 3 (curve shape) ✅** — `scripts/pr1-2-profile.mjs`: per-submit latency ≈ const across
50→400 ticks (growth ×1.46, fsync jitter, not algorithmic). Re-running the PR-1.1a 4×12 daemon profile:
tick latency avg/max **88 / 114 ms** (was ~465 / 812) and max drift **71 ms** (was ~11 s). Cold
recovery is still O(history) (~7.9 s / 400 ticks here) — the remaining wall PR-1.2c closes with
snapshots. Re-run: `node --import tsx scripts/pr1-2-profile.mjs`.

Suite 32/32, typecheck clean. **Next: PR-1.2c** (snapshot + tail replay) builds on this proven
`IncrementalState` (already shown serialisable by the Gate-1 split/resume test).

## The risk this closes

After PP#2 + H3.5 the dominant unknown is no longer model correctness but:

> Can the node run continuously as history grows — without latency degradation and without
> multi-hour recovery?

PR-1.1 measured both walls (runtime O(n)/tick; recovery O(n)). PR-1.2 removes both with one
foundation — maintained live state + discardable snapshots — under two invariants (§5) that keep the
frozen core safe. This review fixes that foundation before a line of PR-1.2 code.

## Related
- `pr1-charter.md` — PR-1 charter + the PR-1.1a profile (the measurements this review responds to).
- `orchestrator/src/node/persistent-node.ts` (`OvtNode`) / `orchestrator/src/node.ts` (`run()`) — the
  current fold + WAL the architecture refactors.
- `operational-validation-track.md` — OVT-2 (crash→replay) + OVT-SG (the recovery measurement).
