# PR-1.5 — Monitoring / Drift-Watch

**Date:** 2026-06-08 · Branch `post-freeze/pr1` · Turns the PR-1.4 metrics surface into operational
signals. Pure & observational throughout — **monitoring observes, consensus decides**; nothing here is
an authority for recovery/consensus/publication. Above the Freeze Surface.

## Four directions (`src/node/monitoring.ts`)

1. **Node health** — `nodeHealth(report) → { HEALTHY | DEGRADED | UNHEALTHY, reasons }`, the worst of the
   SLA signal and scheduler-drift (configurable thresholds; default drift warn 500 ms / crit 2 s).
   Classification only; the input for PR-1.6 alerting.
2. **Recovery SLA watch** — `slaWatch(report) → { SLA_OK | SLA_AT_RISK | SLA_VIOLATED }` on the live
   `estimatedRecoveryBudgetMs` (PR-1.4) vs the 60 s SLA (at-risk at 0.8·SLA, so the SLA-derived cadence
   sits comfortably in OK and only a stalled/over-long tail escalates). The SLA is now a first-class
   status, so 1.6 alerting is trivial.
3. **Growth watch** — `GrowthWatch` accumulates bounded samples and reports per-second rates for
   `walBytes`, `agents`, `events`, `heapBytes` — the data the soak (1.9) will lean on, given the two
   known dynamics (per_tick grows with state size; in-memory transcript grows with run length).
4. **Drift detection (H3.3 continuous)** — `detectDrift(ts, oracle)` compares per-tick
   `(stateRoot, globalRoot)` byte-for-byte against an independent oracle; passive (reports, never
   reconciles). The production oracle is the **live Go node**.

## Drift-watch: real TS↔Go, with teeth

`scripts/pr1-5-drift-watch.mjs` makes H3.3 continuous against the actual second runtime, reusing the
proven cross-language contract (`orchestrator-go/cmd/soak`): a live TS daemon commits a stream → exported
as a soak-stream doc (canonical CALs/traces + the TS per-tick roots) → the **independent Go node re-folds
the identical stream** and must reproduce every STATE_ROOT, every CE §6.3 global root, the final root,
and the event-log SHA-256. Measured run (24 ticks):

```
live daemon committed 24 ticks; root == batch run()
clean stream  → Go re-fold: DRIFT_OK        (every root reproduced)
tampered root → Go re-fold: DRIFT_DETECTED  (Go caught the injected divergence)
```

The negative control (tamper one pinned root ⇒ the Go node disagrees) proves the watch has **teeth** —
it is a real Go computation, not a TS surrogate. (Golden vectors proved TS == Go point-wise; this makes
that agreement continuous over a live stream — the H3.3 claim.)

## DoD gates (`test/pr1-monitoring.test.ts`, 5/5)

1. **Health** — classification correct across HEALTHY / DEGRADED (drift or SLA-at-risk) / UNHEALTHY
   (drift-crit or SLA-violated); a normal daemon is healthy on the SLA dimension.
2. **SLA watch** — thresholds correct; live, the budget rises with the tail and clears after a cadence
   snapshot.
3. **Growth watch** — rates computed from samples; sampling changes no root (observer rule).
4. **Drift teeth** — `detectDrift` flags an injected stateRoot/globalRoot/length divergence and locates
   it; the live Go path is exercised by the drift-watch script.

Suite 69/69, typecheck clean.

## Position
```
Operational Kernel ✅  →  Metrics ✅  →  Monitoring / Drift-Watch ✅ (this)
  →  Alerting (1.6, consumes nodeHealth / slaWatch / detectDrift)
  →  Backup/Restore (1.7)  →  Live Observer (1.8, H3.5-live)  →  Soak (1.9, uses GrowthWatch + drift-watch)
```

## Related
- `src/node/monitoring.ts` — nodeHealth / slaWatch / GrowthWatch / detectDrift.
- `scripts/pr1-5-drift-watch.mjs` — live TS↔Go drift check (needs the Go toolchain; `GO_BIN` override).
- `orchestrator-go/cmd/soak` — the independent Go re-fold verifier reused as the drift oracle.
- `pr1.4-metrics.md` — the observational surface this consumes.
