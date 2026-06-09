# PR-1.6 — Alerting

**Date:** 2026-06-08 · Branch `post-freeze/pr1` · A thin lifecycle layer over the PR-1.5 monitoring
signals. Alerts are OBSERVERS — they read signals and emit notifications; the manager's only state is
alert lifecycle, never an authority for recovery/consensus/publication. Above the Freeze Surface.

## Rules (`src/node/alerting.ts`)

Three orthogonal rules — one signal each, so severities are precise and nothing double-fires:

| key | signal (PR-1.5) | WARNING | CRITICAL |
|---|---|---|---|
| `recovery-sla` | `slaWatch` | SLA_AT_RISK | SLA_VIOLATED |
| `scheduler-drift` | `tickDriftMs.max` | ≥ warn (500 ms) | ≥ crit (2 s) |
| `ts-go-drift` | `detectDrift` | — | DRIFT_DETECTED |

(`nodeHealth` stays the aggregate *view*; alerts fire on the specific dimensions so an operator sees
which one tripped, without one condition raising two alerts.)

## Lifecycle (`AlertManager`)

`evaluate(input)` returns only the TRANSITIONS since the last call:
- condition becomes true → one `FIRING` event;
- still true at the same severity → **deduplicated** (no event);
- severity changes while firing → a fresh `FIRING` at the new severity (escalation/de-escalation);
- condition clears → one `RESOLVED` event;
- nothing wrong → no events.

`active()` exposes the currently-firing set (criticals first) for a status surface. The only state held
is the firing map — pure alert lifecycle.

## DoD gates (`test/pr1-alerting.test.ts`, 6/6)

- No events when clear.
- `recovery-sla`: WARNING → CRITICAL escalation → RESOLVED, with dedup between repeats.
- `scheduler-drift`: fires WARNING/CRITICAL at thresholds, no false positive below warn.
- `ts-go-drift`: CRITICAL on a detected divergence (message locates tick + field), resolves on DRIFT_OK,
  no fire when no drift result is supplied.
- Orthogonality: an SLA violation trips only `recovery-sla`.
- `active()` lists firing alerts, highest severity first.

Each rule has teeth (fires on its condition, stays silent otherwise). Suite 75/75, typecheck clean.

## Position
```
Operational Kernel ✅ → Metrics ✅ → Monitoring/Drift-Watch ✅ → Alerting ✅ (this)
  → Backup/Restore (1.7)  → Live Observer (1.8, H3.5-live)  → Soak (1.9)
```

The observability stack is now end to end: metrics (1.4) → signals (1.5) → alerts (1.6). Remaining PR-1
work is operational hardening (backup/restore), the external H3.5-live observer, and the soak.

## Related
- `src/node/alerting.ts` — AlertRule / AlertManager / defaultAlertRules.
- `pr1.5-monitoring.md` — the signals (slaWatch / tick drift / detectDrift) these rules consume.
