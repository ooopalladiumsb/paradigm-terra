// PR-1.4 — metrics. A purely OBSERVATIONAL layer over the proven operational kernel: it reads, it never
// decides. No metric is ever an authority for recovery, consensus, or publication ("metrics are
// observers, never authorities"). Above the Freeze Surface. Three classes:
//   A correctness-adjacent + B capacity  → NodeObservation (persistent-node.ts, computed from state+disk)
//   C performance                        → PerformanceMetrics (windowed last/avg/max, here)
// plus a computed estimated_recovery_budget_ms from the PR-1.3 cost model — the live SLA budget that
// monitoring (PR-1.5/1.6) can alert on directly instead of via a proxy.

import type { NodeObservation } from "./persistent-node.js";
import { predictedRecoveryMs, REFERENCE_PER_TICK_RECOVERY_MS, REFERENCE_SNAPSHOT_LOAD_MS, RECOVERY_MARGIN_MS } from "./recovery-sla.js";

export interface Stat {
  readonly last: number;
  readonly avg: number;
  readonly max: number;
  readonly n: number;
}

/** A bounded window of samples → last / avg / max. Bounded memory (cap), so it does not grow with run
 *  length (unlike the event log) — a metrics layer must not itself become an unbounded cost. */
export class Window {
  private buf: number[] = [];
  private head = 0;
  private lastV = 0;
  private count = 0;
  constructor(private readonly cap = 256) {}
  add(x: number): void {
    this.lastV = x;
    this.count++;
    if (this.buf.length < this.cap) this.buf.push(x);
    else {
      this.buf[this.head] = x;
      this.head = (this.head + 1) % this.cap;
    }
  }
  stat(): Stat {
    if (this.buf.length === 0) return { last: 0, avg: 0, max: 0, n: 0 };
    let sum = 0;
    let max = -Infinity;
    for (const v of this.buf) {
      sum += v;
      if (v > max) max = v;
    }
    return { last: this.lastV, avg: sum / this.buf.length, max, n: this.count };
  }
}

/** Class C — performance (the basis for later alerting). */
export interface PerformanceMetrics {
  readonly tickDurationMs: Stat;
  readonly tickDriftMs: Stat;
  readonly submitLatencyMs: Stat;
  readonly snapshotDurationMs: Stat;
  readonly recoveryDurationMs: number; // single value, measured once at start
}

/** The full PR-1.4 metrics surface: observation (A+B) + performance (C) + the live SLA budget. */
export interface MetricsReport {
  readonly observation: NodeObservation; // A correctness-adjacent + B capacity
  readonly performance: PerformanceMetrics; // C
  /** PR-1.3 model applied to the LIVE tail: snapshot_load + tail_since_snapshot × per_tick + margin.
   *  The actual SLA budget, so monitoring can alert on the SLA itself, not a proxy. */
  readonly estimatedRecoveryBudgetMs: number;
}

/** Compute the live recovery budget from the current tail (PR-1.3 cost model, reference constants). */
export function estimatedRecoveryBudgetMs(tailTicksSinceSnapshot: number): number {
  return predictedRecoveryMs(tailTicksSinceSnapshot, REFERENCE_SNAPSHOT_LOAD_MS, REFERENCE_PER_TICK_RECOVERY_MS, RECOVERY_MARGIN_MS);
}
