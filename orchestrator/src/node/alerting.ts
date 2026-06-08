// PR-1.6 — alerting: turn the PR-1.5 monitoring signals into deduplicated FIRING→RESOLVED events. Like
// metrics and monitoring, alerts are OBSERVERS — they read signals and emit notifications; their state
// is alert lifecycle only, never an authority for recovery/consensus/publication. Above the Freeze
// Surface. Each rule maps to ONE orthogonal signal so severities are precise and nothing double-fires:
//   recovery-sla     ← slaWatch          (WARNING at-risk / CRITICAL violated)
//   scheduler-drift  ← tick drift (perf) (WARNING ≥ warn / CRITICAL ≥ crit)
//   ts-go-drift      ← detectDrift        (CRITICAL on a divergence)

import type { MetricsReport } from "./metrics.js";
import { DEFAULT_HEALTH, slaWatch, type DriftResult, type HealthThresholds } from "./monitoring.js";

export type Severity = "WARNING" | "CRITICAL";
export type AlertState = "FIRING" | "RESOLVED";
const SEV_RANK: Record<Severity, number> = { WARNING: 0, CRITICAL: 1 };

export interface AlertEvent {
  readonly key: string;
  readonly state: AlertState;
  readonly severity: Severity; // on RESOLVED, the severity it was firing at
  readonly message: string;
  readonly atMs: number;
}

/** What a rule decides for one observation. `firing: false` means the condition is clear. */
export interface RuleVerdict {
  readonly firing: boolean;
  readonly severity: Severity;
  readonly message: string;
}

export interface AlertInput {
  readonly report: MetricsReport;
  readonly drift?: DriftResult; // latest TS↔oracle drift check, if any
  readonly nowMs?: number;
}

export interface AlertRule {
  readonly key: string;
  evaluate(input: AlertInput): RuleVerdict;
}

const clear = (severity: Severity = "WARNING"): RuleVerdict => ({ firing: false, severity, message: "" });

/** The default rules over the existing monitoring signals (no new computation of state). */
export function defaultAlertRules(th: HealthThresholds = DEFAULT_HEALTH): AlertRule[] {
  return [
    {
      key: "recovery-sla",
      evaluate({ report }) {
        const w = slaWatch(report);
        if (w.status === "SLA_VIOLATED") return { firing: true, severity: "CRITICAL", message: `recovery budget ${Math.round(w.budgetMs)}ms ≥ SLA ${w.slaMs}ms` };
        if (w.status === "SLA_AT_RISK") return { firing: true, severity: "WARNING", message: `recovery budget ${Math.round(w.budgetMs)}ms approaching SLA ${w.slaMs}ms` };
        return clear();
      },
    },
    {
      key: "scheduler-drift",
      evaluate({ report }) {
        const d = report.performance.tickDriftMs.max;
        if (d >= th.driftCritMs) return { firing: true, severity: "CRITICAL", message: `tick drift ${Math.round(d)}ms ≥ ${th.driftCritMs}ms` };
        if (d >= th.driftWarnMs) return { firing: true, severity: "WARNING", message: `tick drift ${Math.round(d)}ms ≥ ${th.driftWarnMs}ms` };
        return clear();
      },
    },
    {
      key: "ts-go-drift",
      evaluate({ drift }) {
        if (drift && drift.status === "DRIFT_DETECTED") {
          const d = drift.firstDivergence;
          return { firing: true, severity: "CRITICAL", message: d ? `TS↔oracle drift at tick ${d.tick} (${d.field}): ts=${d.ts} oracle=${d.oracle}` : "TS↔oracle drift detected" };
        }
        return clear("CRITICAL");
      },
    },
  ];
}

/**
 * Stateful alert lifecycle over a set of rules. `evaluate` returns only the TRANSITIONS since the last
 * call: a rule firing for the first time → one FIRING event (deduplicated while it stays firing); a
 * severity change while firing → a new FIRING event at the new severity; the condition clearing → one
 * RESOLVED event. No spam while a condition holds, and no event when nothing is wrong.
 */
export class AlertManager {
  private readonly firing = new Map<string, { severity: Severity; message: string }>();
  constructor(private readonly rules: AlertRule[] = defaultAlertRules()) {}

  evaluate(input: AlertInput): AlertEvent[] {
    const atMs = input.nowMs ?? Date.now();
    const events: AlertEvent[] = [];
    for (const rule of this.rules) {
      const v = rule.evaluate(input);
      const active = this.firing.get(rule.key);
      if (v.firing) {
        if (!active) {
          this.firing.set(rule.key, { severity: v.severity, message: v.message });
          events.push({ key: rule.key, state: "FIRING", severity: v.severity, message: v.message, atMs });
        } else if (active.severity !== v.severity) {
          // escalation / de-escalation while still firing → a fresh event at the new severity
          this.firing.set(rule.key, { severity: v.severity, message: v.message });
          events.push({ key: rule.key, state: "FIRING", severity: v.severity, message: v.message, atMs });
        }
        // else: still firing at the same severity → deduplicated, no event
      } else if (active) {
        this.firing.delete(rule.key);
        events.push({ key: rule.key, state: "RESOLVED", severity: active.severity, message: `resolved: ${active.message}`, atMs });
      }
    }
    return events;
  }

  /** Currently-firing alerts (for a status surface), highest severity first. */
  active(): ReadonlyArray<{ key: string; severity: Severity; message: string }> {
    return [...this.firing.entries()]
      .map(([key, v]) => ({ key, severity: v.severity, message: v.message }))
      .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  }
}
