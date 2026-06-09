// PR-1.5 — monitoring: turn the PR-1.4 metrics surface into operational SIGNALS. Pure & observational
// ("monitoring observes, consensus decides") — every function here only classifies an observation; none
// touches state, recovery, or publication. Above the Freeze Surface. Four directions:
//   1. Node Health      — HEALTHY / DEGRADED / UNHEALTHY (for PR-1.6 alerting)
//   2. Recovery Watch   — SLA_OK / SLA_AT_RISK / SLA_VIOLATED on the live recovery budget
//   3. Growth Watch     — wal / state / memory growth rates (for the soak)
//   4. Drift detection  — per-tick (stateRoot, globalRoot) TS vs an independent oracle (H3.3 continuous)

import type { MetricsReport } from "./metrics.js";
import { RECOVERY_SLA_MS } from "./recovery-sla.js";

// ---- 2. Recovery SLA watch ----------------------------------------------------------------------
export type SlaStatus = "SLA_OK" | "SLA_AT_RISK" | "SLA_VIOLATED";
export interface SlaWatch {
  readonly status: SlaStatus;
  readonly budgetMs: number;
  readonly slaMs: number;
}
/** Classify the live recovery budget against the SLA. `atRiskFraction` (default 0.8) is the fraction of
 *  the SLA above which we flag risk — the SLA-derived cadence sits comfortably below it, so a normal run
 *  reads SLA_OK and only a stalled/over-long tail escalates. */
export function slaWatch(report: MetricsReport, slaMs = RECOVERY_SLA_MS, atRiskFraction = 0.8): SlaWatch {
  const budgetMs = report.estimatedRecoveryBudgetMs;
  const status: SlaStatus = budgetMs >= slaMs ? "SLA_VIOLATED" : budgetMs >= slaMs * atRiskFraction ? "SLA_AT_RISK" : "SLA_OK";
  return { status, budgetMs, slaMs };
}

// ---- 1. Node health -----------------------------------------------------------------------------
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export interface HealthThresholds {
  readonly driftWarnMs: number; // tick drift → DEGRADED at/above this
  readonly driftCritMs: number; // tick drift → UNHEALTHY at/above this
}
export const DEFAULT_HEALTH: HealthThresholds = { driftWarnMs: 500, driftCritMs: 2_000 };
export interface NodeHealth {
  readonly status: HealthStatus;
  readonly reasons: readonly string[]; // why it is not HEALTHY (empty when HEALTHY)
}
const RANK: Record<HealthStatus, number> = { HEALTHY: 0, DEGRADED: 1, UNHEALTHY: 2 };
/** Classify node health from a metrics report (worst of the SLA signal and the scheduler-drift signal).
 *  Classification only — it never acts. */
export function nodeHealth(report: MetricsReport, th: HealthThresholds = DEFAULT_HEALTH): NodeHealth {
  const reasons: string[] = [];
  let status: HealthStatus = "HEALTHY";
  const worse = (s: HealthStatus) => { if (RANK[s] > RANK[status]) status = s; };

  const sla = slaWatch(report);
  if (sla.status === "SLA_VIOLATED") { worse("UNHEALTHY"); reasons.push(`recovery budget ${Math.round(sla.budgetMs)}ms ≥ SLA ${sla.slaMs}ms`); }
  else if (sla.status === "SLA_AT_RISK") { worse("DEGRADED"); reasons.push(`recovery budget ${Math.round(sla.budgetMs)}ms approaching SLA ${sla.slaMs}ms`); }

  const drift = report.performance.tickDriftMs.max;
  if (drift >= th.driftCritMs) { worse("UNHEALTHY"); reasons.push(`tick drift ${Math.round(drift)}ms ≥ ${th.driftCritMs}ms`); }
  else if (drift >= th.driftWarnMs) { worse("DEGRADED"); reasons.push(`tick drift ${Math.round(drift)}ms ≥ ${th.driftWarnMs}ms`); }

  return { status, reasons };
}

// ---- 3. Growth watch ----------------------------------------------------------------------------
export interface GrowthSample {
  readonly tMs: number; // wall clock of the sample
  readonly walBytes: number;
  readonly agents: number;
  readonly events: number;
  readonly heapBytes: number; // caller-supplied process memory (kept out of this pure module)
}
export interface GrowthRates {
  readonly samples: number;
  readonly spanMs: number;
  readonly walBytesPerSec: number;
  readonly agentsPerSec: number;
  readonly eventsPerSec: number;
  readonly heapBytesPerSec: number;
}
/** Accumulates bounded growth samples and reports per-second rates (first→last over the span). Pure /
 *  observational; collecting samples never affects the node. */
export class GrowthWatch {
  private readonly buf: GrowthSample[] = [];
  constructor(private readonly cap = 1024) {}
  sample(report: MetricsReport, heapBytes: number, tMs: number = Date.now()): void {
    const o = report.observation;
    this.buf.push({ tMs, walBytes: o.walSizeBytes, agents: o.stateAgentCount, events: o.eventCount, heapBytes });
    if (this.buf.length > this.cap) this.buf.shift();
  }
  rates(): GrowthRates {
    const n = this.buf.length;
    if (n < 2) return { samples: n, spanMs: 0, walBytesPerSec: 0, agentsPerSec: 0, eventsPerSec: 0, heapBytesPerSec: 0 };
    const a = this.buf[0]!;
    const b = this.buf[n - 1]!;
    const spanMs = b.tMs - a.tMs;
    const perSec = (d: number) => (spanMs > 0 ? (d * 1000) / spanMs : 0);
    return {
      samples: n,
      spanMs,
      walBytesPerSec: perSec(b.walBytes - a.walBytes),
      agentsPerSec: perSec(b.agents - a.agents),
      eventsPerSec: perSec(b.events - a.events),
      heapBytesPerSec: perSec(b.heapBytes - a.heapBytes),
    };
  }
}

// ---- 4. Drift detection (TS vs an independent oracle; the Go oracle = cmd/soak, see the script) ---
export type DriftStatus = "DRIFT_OK" | "DRIFT_DETECTED";
export interface Checkpoint {
  readonly tick: bigint;
  readonly stateRoot: string;
  readonly globalRoot: string;
}
export interface DriftResult {
  readonly status: DriftStatus;
  readonly checked: number;
  readonly firstDivergence?: { readonly tick: bigint; readonly field: "stateRoot" | "globalRoot" | "length"; readonly ts: string; readonly oracle: string };
}
/** Compare a TS checkpoint stream against an independent oracle's checkpoints, per tick, byte-for-byte
 *  on (stateRoot, globalRoot). PASSIVE — it reports a divergence, it never reconciles. The production
 *  oracle is the live Go node (cmd/soak); this pure form also drives the negative-control test. */
export function detectDrift(ts: readonly Checkpoint[], oracle: readonly Checkpoint[]): DriftResult {
  const n = Math.min(ts.length, oracle.length);
  for (let i = 0; i < n; i++) {
    const a = ts[i]!;
    const b = oracle[i]!;
    if (a.stateRoot !== b.stateRoot) return { status: "DRIFT_DETECTED", checked: i + 1, firstDivergence: { tick: a.tick, field: "stateRoot", ts: a.stateRoot, oracle: b.stateRoot } };
    if (a.globalRoot !== b.globalRoot) return { status: "DRIFT_DETECTED", checked: i + 1, firstDivergence: { tick: a.tick, field: "globalRoot", ts: a.globalRoot, oracle: b.globalRoot } };
  }
  if (ts.length !== oracle.length) {
    return { status: "DRIFT_DETECTED", checked: n, firstDivergence: { tick: BigInt(n), field: "length", ts: String(ts.length), oracle: String(oracle.length) } };
  }
  return { status: "DRIFT_OK", checked: n };
}
