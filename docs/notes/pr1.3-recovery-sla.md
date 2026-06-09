# PR-1.3 — Cold Recovery SLA design review (before code)

**Date:** 2026-06-07 · Branch `post-freeze/pr1` · Pins **the metric that matters** (Cold Recovery Time,
per `pr1-charter.md`) and the mechanism that bounds it. Follows PR-1.2c (recovery *correctness* closed:
A codec, B equivalence, C crash safety). Operations layer, above the Freeze Surface. Design-before-code,
as 1.2a/1.2c — because the measurement below changes PR-1.3's scope.

## The measurement that reshapes PR-1.3

PR-1.2c proved `restore(snapshot) + replay_tail == full_replay`, so the FOLD is now O(tail). But cold
recovery is `OvtNode.open()`, and `open()` still `readFileSync`s the **whole** WAL and `JSON.parse`s
**every** line into memory before slicing the tail. So recovery is still **O(history) in WAL read+parse**
even with a perfect snapshot. Measured (snapshot covering ALL ticks ⇒ empty tail ⇒ zero fold):

```
N ticks     WAL size    open()      tail     ms/tick
   2,000      1.3 MB      424 ms       0       0.212
   8,000      5.1 MB    1,541 ms       0       0.193
  20,000     12.7 MB    3,727 ms       0       0.186
```

Marginal parse cost ≈ **0.184 ms/tick**, dead linear (R²≈1). Extrapolated: **1M ticks ≈ ~184 s recovery
despite a perfect snapshot.** A 60 s SLA is **not** met by 1.2c alone. The snapshot bounds the
fold; it does not bound the read/parse. That is the wall PR-1.3 removes.

## Cost model

```
recovery(open)  =  wal_read_parse(committed ticks)   O(history)   ← the remaining wall
                +  snapshot_load (decode)            O(state)     ← bounded if the agent set is bounded
                +  tail_replay(tail ticks)           O(tail)      ← already bounded (1.2b/1.2c)
```

Goal: make the first term O(tail), so `recovery = O(state + tail)` — independent of total history.

## The fix — tail-seek (recommended), vs WAL segmentation (alternative)

**A. Byte-offset tail-seek (recommended).** Record in the snapshot envelope the WAL **byte offset**
through `covered_tick` (`wal_offset`). On recovery, `open()` seeks to `wal_offset` and reads/parses
only the tail bytes. The node knows the offset at snapshot time (all covered ticks are already written —
`wal_offset = WAL byte size at that moment`). Minimal, fits the existing single-WAL-file model, no new
file lifecycle. `recovery = O(state + tail)`.

**B. WAL segmentation (alternative, deferred).** Roll the WAL into segments aligned to snapshots; recovery
reads only the latest segment(s). More machinery (segment lifecycle, retention, cross-segment torn-tail)
but it also enables WAL *truncation/archival* (bounding WAL disk growth) — a real future need, but a
**different** goal from recovery latency. Recommendation: do **A** now (closes the SLA with the least new
surface); revisit **B** when WAL *disk* growth (not recovery time) becomes the binding constraint.

> Decision point for review: A (byte-offset, now) vs B (segmentation, now). Proposed: **A**.

### What A also forces (a good simplification)

`open()` currently materialises the entire WAL as `this.ticks: WalTick[]` and keeps it for the process
lifetime — itself O(history) memory, and the reason it parses everything. Tail-seek removes the need:
`OvtNode` keeps only a **committed-tick count** (for the next tick index + `tickCount()`), not all blocks.
So PR-1.3 also drops an O(history) in-memory array. (The in-memory `tickResults`/`eventLog` arrays still
grow during a long *run* — a separate runtime-memory concern, not cold recovery; out of PR-1.3 scope.)

## SLA definition

```
Cold recovery completes in < T_SLA for ANY committed history,
given snapshot cadence N chosen so worst-case tail recovery ≤ a budget < T_SLA.
```

Proposed **T_SLA = 60 s** (charter's figure; tunable). After tail-seek, recovery is O(state + tail), so
the SLA becomes a **cadence choice**, not a history limit:

```
worst-case recovery  ≈  snapshot_load  +  N × per_tick_recovery_cost
                                            (per_tick = tail parse + tail fold, measured in 1.3 code)
N_max  =  ⌊ (T_SLA − snapshot_load − margin) / per_tick_recovery_cost ⌋
```

The implementation measures `per_tick_recovery_cost` and `snapshot_load` and pins a concrete N (with
margin). Cadence is exposed as a policy (`snapshot every N committed ticks`); the daemon wires it in
PR-1.1b. PR-1.3 provides the mechanism + the derivation + the proof, not the daemon loop.

## Defensive checks (the tail-seek edges)

- `wal_offset > current WAL size` → byte-level **ahead-of-WAL** → **HARD ABORT** (write-model violation,
  the byte analogue of 1.2c's covered_tick > committed; never self-heal). Lets the ahead-of-WAL check be
  O(1) (stat the WAL) instead of counting all ticks.
- `wal_offset` not on a line boundary (`byte[wal_offset−1] ≠ '\n'`, offset ≠ 0) → snapshot/WAL mismatch →
  **discard the snapshot** (Rule 1) and full-parse the WAL. (Must be caught explicitly: parsing from a
  mid-line offset would throw on the first tail line → empty tail → a *silently wrong* state. The
  boundary check is what makes branch (3) — start with wrong state — unreachable here.)
- torn tail (last line incomplete) → drop it, as today (OVT-2).

## Sub-stages / Gates

```
PR-1.3-A  tail-seek           — wal_offset in the snapshot envelope (version 2); OvtNode.snapshot()
                                records it; open() seeks + parses only the tail; ticks[] → committed
                                count; byte-level ahead-of-WAL abort + boundary validation.
          Gate A: recovery correctness UNCHANGED (full suite green) + recovery time O(tail), flat vs
          total history (open() time at 2 histories with the same tail ≈ equal, within noise).
PR-1.3-B  SLA + cadence        — measure per_tick_recovery_cost + snapshot_load; derive N for T_SLA;
                                expose the cadence policy + a profiler; a guard test asserting recovery
                                from a cadence-bounded tail stays < budget regardless of history.
```

### PR-1.3-A — DONE (2026-06-07): tail-seek, recovery O(state + tail)

Snapshot envelope → **v2** with `wal_offset` (WAL byte offset through `covered_tick`).
`OvtNode.snapshot()` records it (current WAL byte size); `OvtNode.open()` loads the newest valid
snapshot, validates the offset (`offsetOnBoundary`), then `readWalRange(wal_offset, end)` + `parseWalLines`
to fold **only the tail** — `readFileSync`/`parse` of the whole WAL survives only as the no-snapshot
fallback. The node no longer holds WAL blocks in memory (`ticks: WalTick[]` → `committedTicks: number`).
Ahead-of-WAL is now the O(1) byte check `wal_offset > walSize` (hard abort); a `wal_offset` off a line
boundary → discard the snapshot (Rule 1) + full re-fold, so a mid-line offset can never yield a
silently-empty tail.

**Gate A ✅.** Recovery correctness unchanged (suite 53/53, typecheck clean). Measured `open()` with a
snapshot covering all ticks (empty tail) — flat vs history, vs the O(history) full parse before:

```
N ticks    open() BEFORE (full parse)    open() AFTER (tail-seek)
  2,000              424 ms                       8.6 ms
  8,000            1,541 ms                       3.0 ms
 20,000            3,727 ms                       1.3 ms      (~2900× at 20k; ms-scale, FLAT — not O(history))
```

New/changed tests: `snapshot-recovery.test.ts` gains the requested negative control (a checksum-valid
snapshot with `wal_offset += 1` → boundary check fires → full re-fold, NOT a silent wrong recovery);
prefix-snapshot scenarios reworked to real `node.snapshot()`-at-prefix so `wal_offset` is genuine; the
crash matrix's ahead-of-WAL row is now byte-level. **Next: PR-1.3-B** — measure `per_tick_recovery_cost`
+ `snapshot_load`, derive cadence N for T_SLA = 60 s, ship a profiler + an SLA guard test.

### PR-1.3-B — DONE (2026-06-07): cost model validated, cadence derived, SLA guarded

**B1 — cost model validated** (`scripts/pr1-3-recovery-profile.mjs`). `T_recovery ≈ snapshot_load +
tail × per_tick`:
- `per_tick_recovery ≈ 11.6 → 16 ms/tick` (tail 300→1200). The dominant cost is the tail **replay**
  (full validate+reduce, STATE_ROOT recomputed per event) — **not** parsing. It creeps up with tail
  length (in-memory tail accumulation ⇒ GC), and grows sharply with **state size** (STATE_ROOT is
  O(state), the OVT-SG dimension): ~16 ms/tick at 1 agent vs **~195 ms/tick at 200 agents**. A key
  consequence: because the WAL stores *submissions* (not derived events), recovery must re-run the
  pipeline, so the cadence is ~thousands of ticks, not millions — and the daemon must re-derive (tighten)
  the cadence as the agent set grows (at 200 agents N_operational drops to ~140).
- `snapshot_load ≈ 2.3 ms`, flat across history (5.1/0.8/0.8 ms at 300/600/1200) — confirms it is
  f(state), not f(tail).

**B2 — cadence derived** (`src/node/recovery-sla.ts`). Reference constants (conservative):
`per_tick = 18 ms`, `snapshot_load = 10 ms`, `margin = 5 s`, `SAFETY_FACTOR = 2`.
```
N_max         = (60000 − 10 − 5000) / 18           ≈ 3055 ticks
N_operational = N_max / 2                           ≈ 1527 ticks   ⇐ OPERATIONAL_CADENCE_TICKS
predicted recovery @ tail = N_operational ≈ 10 + 1527×18 + 5000 ≈ 32.5 s  ≤ 60 s ✓
```
`OvtNode.maybeSnapshot(N)` snapshots when `snapshotDue` — the per-tick call the daemon makes (PR-1.1b);
keeping the cadence bounds the worst-case recovery tail to N.

**B3 — SLA guard** (`test/recovery-sla.test.ts`), asserting the **model**, never wall-clock (CI-stable):
- *mechanism*: running cadence N ⇒ the recovered tail is ≤ N at any crash point (+ root == full);
- *budget*: the shipped cadence's predicted worst-case recovery ≤ the SLA under the reference constants;
- *model fns*: `maxTailForSla` / `operationalCadence` / `predictedRecoveryMs` / `snapshotDue` correct.

Suite 57/57, typecheck clean. **The recovery/readiness line is now a closed chain:** snapshot protocol
→ tail-seek recovery → validated cost model → cadence policy → 60 s SLA. **PR-1.3 is closed.** Next:
**PR-1.1b** (daemon crash/restart) can now use the real criterion *restart ∧ recovery ≤ SLA*, wiring
`maybeSnapshot` into the tick loop.

## Risk-map position

```
Runtime Scalability   ✅ (1.2b)
Recovery Equivalence  ✅ (1.2c-B)
Crash Safety          ✅ (1.2c-C)
Cold Recovery TIME    ✅ (1.3-A tail-seek + 1.3-B cadence/SLA = 60s)  ⇒ PR-1.3 closed; next PR-1.1b (restart ∧ recovery ≤ SLA)
```

## Related
- `pr1.2c-snapshot-design.md` — the snapshot rules/format PR-1.3 extends (envelope → v2 with `wal_offset`).
- `orchestrator/src/node/persistent-node.ts` — `open()` (the full-WAL parse this removes) + `snapshot()`.
- `orchestrator/src/node/snapshot.ts` / `snapshot-store.ts` — the codec/store that gain `wal_offset`.
- `pr1-charter.md` — Cold Recovery Time as the PR-1 metric; the ~2 h/1M figure this SLA replaces.
