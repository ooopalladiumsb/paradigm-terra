# PR-1.8 — Live Observer (closes H3.5-live)

**Date:** 2026-06-08 · Branch `post-freeze/pr1` · An EXTERNAL party tails a running node and independently
confirms its root in real time, with no involvement from the node. Closes the live half of H3.5 (the
offline half — independent re-derivation of pinned verdicts — was done at the freeze). Strictly
observe-only ("monitoring observes, consensus decides"). Above the Freeze Surface.

## The primitive

`OvtNode.readProgram(dir)` — a READ-ONLY view of a node's durable committed inputs (genesis + WAL tick
blocks), independent of any running node's memory. The basis for re-deriving the roots from the inputs.

## The observer

`LiveObserver.observe(dir)` (`src/node/live-observer.ts`): reads the node's published head + the WAL,
folds the WAL prefix **up to the published tick count**, and compares its independently-derived
STATE_ROOT + global root to the head. Verifying only the published checkpoint keeps the observer
behind-or-equal, never ahead (robust to the WAL-ahead-of-head write race). It writes nothing to the
node directory. → `OBSERVED_OK | OBSERVED_DRIFT | OBSERVED_EMPTY`.

## Cross-language, live, with teeth (the H3.5-live claim)

`scripts/pr1-8-live-observer.mjs` makes it cross-runtime against a **running** daemon: an external
observer reads the live dir, rebuilds the committed stream, and an INDEPENDENT Go node
(`orchestrator-go/cmd/soak`) re-folds it — confirming the live root twice as the node grows, then a
negative control. Measured (daemon RUNNING throughout):

```
node @16 ticks · observer verified published @16 → Go re-fold: OBSERVED_OK      (node state: RUNNING)
node @34 ticks · observer verified published @34 → Go re-fold: OBSERVED_OK      (node state: RUNNING)
tampered published root                          → Go re-fold: OBSERVED_DRIFT   (caught)
```

A third party, in a different language, confirms a live node's root in real time and catches an injected
divergence — and never touches the node. That is H3.5-live.

## DoD gates (`test/pr1-live-observer.test.ts`, 3/3)

1. **Confirms a running node** — `OBSERVED_OK`, derived == published, while the daemon stays `RUNNING`;
   re-confirms after the node advances.
2. **Never ahead** — the observer verifies the published checkpoint; `observedTicks ≤ committedTicks`.
3. **Teeth** — a node publishing a wrong root → `OBSERVED_DRIFT` (independent re-derivation disagrees).
4. **Observe-only** — the node directory is byte-for-byte unchanged after repeated observation.

Suite 84/84, typecheck clean.

## Position
```
Operational Kernel ✅ → Metrics ✅ → Monitoring ✅ → Alerting ✅ → Backup/Restore ✅ → Live Observer ✅ (this)
  → Soak (1.9)
```

Research + operational correctness are closed, the observability/recovery/backup stack is complete, and
H3.5 is now closed end to end (offline + live). **One milestone remains: PR-1.9 — the soak**, the only
stage that surfaces long-run effects (memory growth, cadence/tail behaviour, retention) not visible in
unit tests; it consumes `GrowthWatch` (1.5) and the live drift-watch / observer (1.5/1.8).

## Related
- `src/node/live-observer.ts` — LiveObserver / ObserverVerdict.
- `src/node/persistent-node.ts` — `OvtNode.readProgram()` (read-only committed inputs).
- `scripts/pr1-8-live-observer.mjs` — cross-language live observation (needs the Go toolchain; `GO_BIN`).
- `pr1.5-monitoring.md` — `detectDrift` + the Go `cmd/soak` oracle this reuses; `reproducibility-guide.md` — H3.5 offline.
