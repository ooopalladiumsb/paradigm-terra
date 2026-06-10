# A1 — Long-duration Soak Program · operator runbook

**Tier M, above the Freeze Surface.** How to run the real multi-day soak that A1 ships. The program
(`src/node/soak-program.ts`) + the accelerated proof (`test/a1-soak.test.ts`, in CI) + the representative
driver (`scripts/a1-soak.mjs`) are the *code*; the **7-day (stretch 30-day) wall-clock run is operated
here**. A1 is purely evidential — it measures and reports; any breach opens a *separate* corrective item.

## What it checks (SC-1..6)

| SC | Checked by |
|---|---|
| SC-1 duration | the driver covers the target window (`A1_TARGET_MS`) with zero violations |
| SC-2 zero STATE_ROOT divergence | `consensus` class — live-observer root match (+ TS↔Go drift if wired) |
| SC-3 WAL growth bounded | `growth` class — WAL/heap/state rates recorded, retention bounded |
| SC-4 snapshot+restore equivalence | periodic `backup→restore == live` on the running node |
| SC-5 observer consistency 100% | live-observer verdict every sample |
| SC-6 memory/fd/disk no degradation | fd-leak + disk-runaway rate ceilings + heap rate |
| SC-Freeze | `make freeze-check` byte-identical before & after |

PASS iff **zero violations** across the whole run (`report.ok`).

## Accelerated check (minutes — same loop, short)

```bash
cd orchestrator
node --import tsx --test test/a1-soak.test.ts     # the CI gate
node --import tsx scripts/a1-soak.mjs             # representative run, prints the A1 SOAK REPORT
```

## The real 7-day run

```bash
cd orchestrator
# 7 days = 604800000 ms. Tune A1_ROUNDS so the stream runs continuously for the window; sampling is cheap.
A1_TARGET_MS=604800000 A1_ROUNDS=2000000 \
  nohup node --import tsx scripts/a1-soak.mjs > a1-soak-$(date +%F).log 2>&1 &
```
- Run it on the deployment host (or a dedicated soak box), detached (`nohup`/systemd/tmux).
- **Stretch 30-day:** `A1_TARGET_MS=2592000000` and a proportionally larger `A1_ROUNDS`.
- The process restarts the daemon mid-run (built-in crash/restart) to exercise recovery over time; the
  host itself should also survive an OS restart — re-launch and let it resume sampling.

## Monitoring during the run
- Tail the log: the report prints `fd rate`, `disk rate`, `heap rate`, `max tail`, restore-check count.
- Healthy signal: **fd rate ≈ 0**, heap rate flat (no leak), disk rate bounded (WAL grows linearly,
  snapshot retention bounded; enable M3-B compaction on the host to bound it hard), zero violations.
- Any `✗ [class]` line ⇒ the run FAILS the gate → open a corrective item naming the class
  (`durability`/`resource`/`consensus`/`recovery`/`growth`/`operational`/`duration`).

## Gate / sign-off
1. `make freeze-check` green before the run (baseline) and after (no Freeze-Surface drift).
2. The run prints `✅ A1 soak PASSED` with the target window met and zero violations.
3. Record the report (committed ticks, restarts, restore-checks, the rates) as the A1 evidence.

## Related
- `a1-soak-charter.md` — scope, the wall-clock model, the SC table.
- `src/node/soak-program.ts` — `SoakProgram` (composes the PR-1.9 `SoakMonitor`).
- `pr1.9-soak.md` / `scripts/pr1-9-soak.mjs` — the PR-1.9 soak this extends (incl. the Go drift checkpoint, addable to a long run).
