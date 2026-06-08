// PR-1.9 — soak harness. The final readiness gate: behaviour OVER TIME, the one risk class that no
// architecture, unit test, or review can prove. PURELY EVIDENTIAL — it observes, measures, records, and
// reports; it changes nothing. Any invariant breach found in a soak opens a SEPARATE corrective PR, so
// the gate stays independent. It composes the existing observability (PR-1.4–1.8) — no new functionality.
//
// Five invariant classes, checked per sample:
//   consensus    — TS↔oracle drift = 0 (drift-watch) and live-observer = OK
//   recovery     — tail ≤ cadence; estimatedRecoveryBudgetMs ≤ SLA
//   growth       — snapshot retention bounded (rates are recorded for the report)
//   operational  — zero active CRITICAL alerts
//   restart      — exercised by the harness (noteRestart); continuity is re-checked by the above

import type { MetricsReport } from "./metrics.js";
import { DEFAULT_HEALTH, GrowthWatch, type DriftResult, type GrowthRates, type HealthThresholds } from "./monitoring.js";
import { AlertManager, defaultAlertRules } from "./alerting.js";
import { OPERATIONAL_CADENCE_TICKS, RECOVERY_SLA_MS } from "./recovery-sla.js";
import type { ObserverVerdict } from "./live-observer.js";

export interface SoakViolation {
  readonly class: "consensus" | "recovery" | "growth" | "operational";
  readonly detail: string;
  readonly atMs: number;
  readonly committedTicks: number;
}

export interface SoakReport {
  readonly ok: boolean;
  readonly samples: number;
  readonly restarts: number;
  readonly committedTicks: number;
  readonly violations: readonly SoakViolation[];
  readonly maxTailTicks: number;
  readonly maxBudgetMs: number;
  readonly maxStateAgents: number;
  readonly growth: GrowthRates;
}

export interface SoakSampleExtra {
  readonly drift?: DriftResult; // latest TS↔oracle drift check (if run this sample)
  readonly observer?: ObserverVerdict; // latest external live-observer verdict (if run this sample)
  readonly heapBytes?: number;
  readonly nowMs?: number;
}

export interface SoakConfig {
  readonly cadence?: number; // snapshot cadence (tail bound)
  readonly slaMs?: number;
  readonly snapshotRetention?: number; // expected retained snapshots (keep); harness flags > keep+1
  // scheduler-drift alert thresholds. Tuned to the DEPLOYMENT's tick interval (drift is meaningful only
  // relative to it); an accelerated harness also perturbs its own scheduling via synchronous sampling,
  // so set these generously there. The correctness-bearing alerts (recovery-sla, ts-go-drift) are not
  // affected by this — they always escalate.
  readonly alertThresholds?: HealthThresholds;
}

/**
 * Accumulates per-sample invariant checks over a long run into a verdict. Observer only: it holds an
 * AlertManager + GrowthWatch (lifecycle/measurement state), never node state, and never acts on the node.
 */
export class SoakMonitor {
  private readonly cadence: number;
  private readonly slaMs: number;
  private readonly retentionMax: number;
  private readonly alerts: AlertManager;
  private readonly growth = new GrowthWatch();
  private readonly violations: SoakViolation[] = [];
  private samples = 0;
  private restarts = 0;
  private maxTail = 0;
  private maxBudget = 0;
  private maxAgents = 0;
  private lastCommitted = 0;

  constructor(cfg: SoakConfig = {}) {
    this.cadence = cfg.cadence ?? OPERATIONAL_CADENCE_TICKS;
    this.slaMs = cfg.slaMs ?? RECOVERY_SLA_MS;
    this.retentionMax = (cfg.snapshotRetention ?? 2) + 1; // a transient extra is fine; more is a leak
    this.alerts = new AlertManager(defaultAlertRules(cfg.alertThresholds ?? DEFAULT_HEALTH));
  }

  record(report: MetricsReport, extra: SoakSampleExtra = {}): void {
    const atMs = extra.nowMs ?? Date.now();
    const o = report.observation;
    this.samples++;
    this.lastCommitted = o.committedTicks;
    this.alerts.evaluate({ report, drift: extra.drift, nowMs: atMs });
    this.growth.sample(report, extra.heapBytes ?? 0, atMs);

    const add = (cls: SoakViolation["class"], detail: string) => this.violations.push({ class: cls, detail, atMs, committedTicks: o.committedTicks });

    // consensus
    if (extra.drift?.status === "DRIFT_DETECTED") {
      const fd = extra.drift.firstDivergence;
      add("consensus", fd ? `TS↔oracle drift at tick ${fd.tick} (${fd.field}): ts=${fd.ts} oracle=${fd.oracle}` : "TS↔oracle drift");
    }
    if (extra.observer?.status === "OBSERVED_DRIFT") add("consensus", `live-observer drift (derived ${extra.observer.derivedStateRoot} ≠ ${extra.observer.claimedStateRoot})`);
    // recovery
    if (o.tailTicksSinceSnapshot > this.cadence) add("recovery", `tail ${o.tailTicksSinceSnapshot} > cadence ${this.cadence}`);
    if (report.estimatedRecoveryBudgetMs > this.slaMs) add("recovery", `recovery budget ${Math.round(report.estimatedRecoveryBudgetMs)}ms > SLA ${this.slaMs}ms`);
    // growth
    if (o.snapshotCount > this.retentionMax) add("growth", `snapshot retention ${o.snapshotCount} > ${this.retentionMax}`);
    // operational
    const criticals = this.alerts.active().filter((a) => a.severity === "CRITICAL").length;
    if (criticals > 0) add("operational", `${criticals} active CRITICAL alert(s)`);

    if (o.tailTicksSinceSnapshot > this.maxTail) this.maxTail = o.tailTicksSinceSnapshot;
    if (report.estimatedRecoveryBudgetMs > this.maxBudget) this.maxBudget = report.estimatedRecoveryBudgetMs;
    if (o.stateAgentCount > this.maxAgents) this.maxAgents = o.stateAgentCount;
  }

  noteRestart(): void {
    this.restarts++;
  }

  report(): SoakReport {
    return {
      ok: this.violations.length === 0,
      samples: this.samples,
      restarts: this.restarts,
      committedTicks: this.lastCommitted,
      violations: this.violations,
      maxTailTicks: this.maxTail,
      maxBudgetMs: this.maxBudget,
      maxStateAgents: this.maxAgents,
      growth: this.growth.rates(),
    };
  }
}
