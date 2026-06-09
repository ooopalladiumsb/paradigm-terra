# PR-1 — Production Readiness Closure Report

**Date:** 2026-06-08 · Branch `post-freeze/pr1` · Commit range `600d727 … 9a5d9ec` (the PR-1.2b→1.9
implementation series; the PR-1 charter `2190d51`, daemon skeleton `f1cb113`, and runtime-state review
`d7e3ff7` precede it).

## Scope & objective

Transform the PFC-1 frozen consensus kernel into an operationally validated system **without modifying
the Freeze Surface**. PR-1 builds strictly above the frozen `canonical / dsl / cal / cal-reducer /
cal-gas / validator` modules, composing them through `OvtNode` / `applyTick`.

**Freeze-Surface guarantee — verified.** `git diff --name-only 600d727^..HEAD` touches only:
`orchestrator/` (33 files), `docs/` (10), `.gitignore` (1). **Zero** normative-module files changed.

## Discipline (held on every stage)

design-review doc before code → one commit per gate → full suite + typecheck green before commit →
a negative control ("teeth") per claim → observability layers are **observers, never authorities** (no
metric/monitor/alert/observer feeds back into recovery, consensus, or publication).

## Closed risk classes

| Risk class | Stage / commit | Primary evidence | Negative control (teeth) | Result |
|---|---|---|---|---|
| Runtime scalability | 1.2b `600d727` | `incremental-equivalence.test.ts`, `incremental-node.test.ts`, `pr1-2-profile.mjs` | carry corruption (`lastEventHash`) flips the equivalence test | O(n)/tick fold removed; daemon 465/812ms→88/114ms, drift 11s→71ms |
| Recovery correctness | 1.2c-A/B `2335c0d`,`9ee8b1f` | `snapshot-codec.test.ts`, `recovery-equivalence.test.ts`, `snapshot-recovery.test.ts` | `$bytes` round-trip; ahead-of-WAL abort; corrupted snapshot → WAL | `restore(snapshot)+tail == full_replay(WAL)` at every cut-point |
| Crash safety | 1.2c-C `91ea464` | `snapshot-crash-matrix.test.ts` (6 rows) | forbidden-state (snapshot newer than WAL) → hard abort | no crash point yields a wrong state |
| Recovery SLA | 1.3-A/B `034d0b5`,`e9a41b5` | `pr1-3-recovery-profile.mjs`, `recovery-sla.test.ts` | wal_offset off a line boundary → discard, not silent empty tail | tail-seek makes recovery O(state+tail); cadence ≈1527 ⇒ <60 s; model-based guard |
| Daemon restart | 1.1b `192e38f` | `pr1-daemon-restart.test.ts` | `simulateCrash` → restart; max-tail boundary | crashed+recovered == uninterrupted; SNAPSHOT_TAIL utilization |
| Metrics | 1.4 `e706693` | `pr1-metrics.test.ts` | observe-many → roots unchanged (observers-not-authorities) | A/B/C surface + live recovery budget |
| Monitoring | 1.5 `f6232ef` | `pr1-monitoring.test.ts`, `pr1-5-drift-watch.mjs` | injected drift → DRIFT_DETECTED (real Go) | health / SLA-watch / growth / drift signals |
| Alerting | 1.6 `09f09b0` | `pr1-alerting.test.ts` | each rule fires on its condition, silent otherwise; dedup | FIRING→RESOLVED lifecycle, orthogonal rules |
| Backup / restore | 1.7 `60565ea` | `pr1-backup.test.ts` | missing WAL/genesis/manifest → fail; tampered manifest → fail | Backup Equivalence on 7 quantities; verified round-trip |
| Independent live verification | H3.5 offline + 1.8 `eac5235` | `pr1-live-observer.test.ts`, `pr1-8-live-observer.mjs` | tampered published root → OBSERVED_DRIFT (real Go) | external Go observer confirms a RUNNING node in real time |
| Long-running operational soak | 1.9 `9a5d9ec` | `pr1-soak.test.ts`, `pr1-9-soak.mjs` | injected consensus/recovery/growth breach → flagged | 0 violations over 120 ticks + restart + TS↔Go checkpoint |

## Recovery proven on three independent axes

correctness (`restore+tail == full_replay`, 1.2c-B) · crash safety (the crash matrix, 1.2c-C) · time
budget (the SLA cost model + cadence, 1.3). Most systems reach only the first.

## Cross-language independent verification (TS ↔ Go)

The frozen `orchestrator-go` node is the second runtime. Golden vectors prove TS == Go point-wise; PR-1
makes that agreement **continuous and live**: the drift-watch (1.5) and the live observer (1.8) export
the committed stream and the independent Go node (`orchestrator-go/cmd/soak`) re-folds it, reproducing
every STATE_ROOT / CE §6.3 global root / event-log SHA-256 — confirmed against a *running* daemon (1.8)
and over a whole soak stream (1.9), each with a tamper negative control.

## Test totals

Orchestrator suite **86/86**, typecheck clean. New PR-1 suites: incremental-equivalence, incremental-node,
recovery-equivalence, snapshot-codec, snapshot-recovery, snapshot-crash-matrix, recovery-sla,
pr1-daemon-restart, pr1-metrics, pr1-monitoring, pr1-alerting, pr1-backup, pr1-live-observer, pr1-soak.
Runnable evidence scripts: pr1-2-profile, pr1-3-recovery-profile, pr1-5-drift-watch, pr1-8-live-observer,
pr1-9-soak (the last three exercise the live Go runtime).

## Final status

```
Production Readiness : PASSED
Freeze Surface       : UNCHANGED (verified: 0 normative files in the range)
Operational Kernel   : VALIDATED
```

## Merge readiness

Working tree clean; suite green; 17 commits `600d727..9a5d9ec` on `post-freeze/pr1` (local, not pushed).
Ready for push / merge to `main` on the maintainer's go. Merge is an outward action — not performed
automatically.

## Deferred (post-PR-1 tracks, not opened here)

- **Launch readiness** — release process, versioning, deployment guide, operator/runbook handbook.
- **Economics / network** — incentives, governance, validator economics (only if the project goes to a real network).
- **Scale** — WAL compaction/archival, remote/incremental/encrypted backup, distributed observers, multi-node; cheap async soak sampling; a real multi-day soak run (the harness already exists).
