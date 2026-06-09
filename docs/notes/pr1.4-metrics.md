# PR-1.4 — Metrics (observational layer)

**Date:** 2026-06-07 · Branch `post-freeze/pr1` · The first observability stage, on top of the proven
operational kernel (PR-1.1b closed runtime/recovery/crash/SLA/restart). Above the Freeze Surface.

## The rule: metrics are observers, never authorities

No metric is ever a source of truth for recovery, consensus, or publication. The metrics layer only
**reads** (live `IncrementalState` + disk) and never feeds back. This is enforced structurally
(`OvtNode.observe()` and `Pr1Daemon.metricsReport()` mutate nothing) and asserted (Gate 3). Every
subsequent stage (1.5 monitoring, 1.6 alerting, 1.8 live-observer) builds on this surface, so its
read-only discipline is load-bearing.

## The surface

Three classes (`src/node/metrics.ts`, `OvtNode.observe()` / `Pr1Daemon.metricsReport()`):

- **A · correctness-adjacent** (diagnostics, not alerts): `stateRoot`, `globalRoot`, `eventCount`,
  `currentTick`, `recoveryMode`, `recoveredTailTicks`.
- **B · capacity** (where the known risks live): `committedTicks`, `stateAgentCount`, `walSizeBytes`,
  `snapshotCount`, **`tailTicksSinceSnapshot`** — the latter is now the control parameter of the
  Recovery SLA (PR-1.3).
- **C · performance** (basis for later alerting): `tickDurationMs`, `tickDriftMs`, `submitLatencyMs`,
  `snapshotDurationMs` — each a windowed `{last, avg, max, n}` over a bounded ring (so the metrics layer
  itself does not grow with run length) — plus `recoveryDurationMs` (measured once at start).

### Computed: `estimatedRecoveryBudgetMs`

The PR-1.3 cost model applied to the **live** tail:
`snapshot_load + tailTicksSinceSnapshot × per_tick + margin` (reference constants). This makes the SLA
budget a first-class metric, so monitoring (1.5/1.6) can alert on the SLA itself — not a proxy — and it
already accounts for the known dynamic that `per_tick` grows with state size (OVT-SG).

## DoD gates (`test/pr1-metrics.test.ts`, 4/4)

1. **Live update** — key metrics populate during daemon operation (committedTicks, snapshotCount,
   tailTicksSinceSnapshot, walSizeBytes, the performance windows, the budget).
2. **Restart continuity** — after a crash+restart the metrics restore to the recovered state
   (`recoveryMode = SNAPSHOT_TAIL`, `recoveredTailTicks`, `committedTicks`) and keep growing from it.
3. **Observers, not authorities** — across the OVT corpus, observing many times changes neither
   STATE_ROOT nor GLOBAL_ROOT, and the node still equals `run()`.

Plus: `estimatedRecoveryBudgetMs` rises with the tail and drops to the floor when a cadence snapshot
fires. Suite 64/64, typecheck clean.

## Risk-map / position

```
Operational Kernel  ✅ (1.1b)
  → Metrics          ✅ (this)
  → Monitoring / Drift Watch (1.5)  → Alerting (1.6)  → Backup/Restore (1.7)
  → Live Observer (1.8, closes H3.5-live)  → Soak (1.9)
```

Monitoring (1.5) consumes this surface — most usefully `tailTicksSinceSnapshot` /
`estimatedRecoveryBudgetMs` (SLA), `tickDriftMs` (scheduler health), `walSizeBytes` / `stateAgentCount`
(growth), and the A-class roots for a TS↔Go drift watch (H3.3 continuous).

## Related
- `src/node/metrics.ts` — Window / Stat / PerformanceMetrics / MetricsReport / estimatedRecoveryBudgetMs.
- `src/node/persistent-node.ts` — `OvtNode.observe()` (NodeObservation, A+B) + `ignoreSnapshots` audit.
- `src/node/pr1-daemon.ts` — `Pr1Daemon.metricsReport()` (A+B+C + budget).
- `pr1.3-recovery-sla.md` — the cost model the budget metric applies live.
