# A1 Charter — Long-duration Soak Program

**Date:** 2026-06-10 · **Status:** charter / pre-registration (no code). Post-release v1.x maintenance
line, **Tier M** (above the Freeze Surface). Follows M1 (CI), M2 (Registry reconciliation), M3
(durability). Ratify before the first A1 PR — same discipline as M2/M3.

## 0. Architect ruling

Ruled 2026-06-10. After M1–M3 closed without moving the Freeze Surface, the remaining
operational-reliability risk is **confidence over time and under sustained load**. A1 is the
long-duration soak that surfaces the one class short tests cannot: leaks, WAL/state drift, snapshot/
restore degradation, observer drift, rare races.

```
Role:           the readiness gate for behaviour OVER TIME (extends the PR-1.9 soak harness)
Mode:           observe-only; the program is built + accelerated-proven in-repo, the wall-clock run is OPERATED
Tier:           M (maintenance)
Freeze Surface: immutable
```

## 1. The one rule

A1 **measures, records, reports, and changes nothing** (the PR-1.9 soak discipline). It adds no verb,
touches no `cal/validator/reducer/canonicalization/economics`, and asserts no consensus authority. Any
invariant breach a soak surfaces opens a *separate* investigation — A1 is the instrument, not the fix.
`freeze-gate` stays byte-identical (SC-Freeze below).

## 2. The wall-clock model (pinned, honest)

A literal 7-day / 30-day run cannot complete inside a build session — and PR-1.9 already established the
model: *"a real multi-day soak runs the same loop longer."* A1 therefore delivers **three** things, and
the long run is **operated**, not faked:

1. **The program** — the extended soak harness + a long-run driver that samples the SC metrics on a
   cadence and emits a final gate report (PASS iff zero violations across the whole run).
2. **An accelerated in-repo proof** — a representative compressed run (the PR-1.9 pattern) that exercises
   every SC check end-to-end, runs in CI, and is the *code* acceptance.
3. **A runbook** — how the operator kicks off, monitors, and reads the verdict of the real 7-day (stretch
   30-day) wall-clock run on deployment infra.

The 7-day/30-day SCs below are the **operational** acceptance, asserted by the program when run for that
duration; the in-repo gate is the accelerated equivalent + the program's correctness.

## 3. Scope

### IN (A1, Tier M)
- Extend `SoakMonitor` (`src/node/soak.ts`) to cover SC-1..SC-6 (most map to existing checks; the new
  ones are periodic restore-equivalence sampling and fd/disk metrics).
- A long-run driver + final gate report; an accelerated CI-runnable representative run.
- The operator runbook for the real multi-day run.

### OUT
- Any `cal/validator/reducer/canonicalization/economics` change (Freeze Surface).
- New verb classes / consensus changes (those are PFC-2 → v2.0.0).
- Acting on a breach (A1 reports; remediation is a separate item).

## 4. Success criteria (pinned)

| SC | Criterion | Instrument |
|---|---|---|
| **SC-1** | a 7-day uninterrupted run (operated; in-repo: accelerated equivalent) | long-run driver + duration gate |
| **SC-2** | zero divergence of `STATE_ROOT` (incl. across restarts + TS↔oracle) | `consensus` violation class (drift + continuity) |
| **SC-3** | WAL growth remains bounded / predictable | `growth` class (WAL rate recorded, bounded) |
| **SC-4** | snapshot + restore equivalence holds throughout the run | NEW: periodic backup→restore == live sample |
| **SC-5** | observer consistency = 100% | `ObserverVerdict` per sample (live-observer root match) |
| **SC-6** | memory / fd / disk show no degradation | heap (exists) + NEW fd/disk metrics, rate-bounded |
| **SC-Freeze** | no Freeze Surface movement; `freeze-gate` byte-identical | the CI freeze gate |
| **Stretch** | a 30-day run | the same program, longer |

PASS iff **zero violations** across the whole run (`SoakReport.ok`). A1's *code* gate is SC-Freeze + the
accelerated run exercising SC-1..SC-6; the 7/30-day figures are the operated acceptance.

## 5. Instrumentation plan

The harness already samples: tail ≤ cadence, recovery budget ≤ SLA, continuous state advance, bounded
state agents, heap/WAL/state growth rates, TS↔oracle drift, live-observer verdict, snapshot retention.
A1 adds, on a (configurable, cheap) cadence:
- **SC-4** — take a backup of the live node, restore into a scratch dir, assert the 7 Backup-Equivalence
  quantities match the live node; also exercise the M3 incremental/compaction restore paths periodically.
- **SC-6** — sample open file descriptors and on-disk footprint (WAL + snapshots + archive) alongside
  heap; flag a sustained upward rate (a leak/unbounded-growth signal), not an absolute number.
- **SC-1** — a duration gate: the driver records wall-clock elapsed and only reports PASS once the target
  window is covered with zero violations; supports checkpoint/resume so a multi-day run survives.
All additions are observe-only and reuse the proven backup/restore/observer functions.

## 6. Failure taxonomy

A soak breach is a **signal**, never a silent pass and never a consensus event:
- **Degradation signal** (a real leak / unbounded growth / divergence / observer drift): recorded as a
  `SoakViolation` of the right class → the run FAILS the gate → opens a separate investigation item.
- **Instrument defect** (a bug in a new A1 check itself): a false violation; fixed in A1. Discriminator:
  does the breach reproduce against the proven underlying function (backup/restore/observer) directly? If
  the underlying function is correct and only the A1 sampler flags, it is an instrument defect.
Neither can move the Freeze Surface — A1 only observes.

## 7. Branch policy
Working branch: **`post-release/a1-soak`** (off `main`, like M1/M2/M3). The accelerated proof + harness
land as ordinary operational PRs up to `main` (branch-protected). The real multi-day run is operated on
infra and is not a CI gate.

## 8. Related
- `pr1.9-soak.md` / `src/node/soak.ts` — the `SoakMonitor`/`SoakReport` harness A1 extends (it already named the multi-day run as "the same loop, longer").
- `pr1.8-live-observer.md` — the live-observer verdict feeding SC-5.
- `m3-charter.md` / `src/node/backup*.ts` / `wal-compaction.ts` — the backup/restore/compaction paths SC-4 samples.
- `roadmap-v1.x.md` — the "Long-duration soak program" Tier-M item A1 fulfils; precedes a possible PFC-2 → v2.0.0 (jetton/TEP-74) once A1 gives a multi-day baseline.
