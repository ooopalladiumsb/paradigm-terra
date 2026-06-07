// PR-1.1a — daemon skeleton: the node as a long-running PROCESS (a thing that lives for hours), not
// a batch fold. Operations layer, ABOVE the Freeze Surface — it wraps the proven OVT-2 `OvtNode`
// (durable WAL + deterministic re-fold) and adds lifecycle, a wall-clock tick driver, an async
// submission mempool, and an observation surface. No network / p2p / RPC / monitoring (those are
// later PR-1 stages); this stage exists to make the daemon's real behavior OBSERVABLE.
//
// Known property surfaced here (NOT fixed at this stage — that is PR-1.2): `OvtNode.submit()` re-folds
// the whole WAL from genesis each tick (O(n)/tick), the same root cause as the ~2 h/1M cold-recovery
// bound. The metrics below MEASURE the resulting per-tick latency growth, so PR-1.2 (snapshot + tail
// replay + maintained live state) optimizes against data, not a forecast.

import { OvtNode } from "./persistent-node.js";
import type { Submission, Program } from "../index.js";

type State = NonNullable<Program["genesisState"]>;
export type DaemonState = "BOOTING" | "RECOVERING" | "CATCHING_UP" | "RUNNING" | "SHUTTING_DOWN" | "STOPPED";

export interface DaemonStatus {
  readonly state: DaemonState;
  readonly committedTicks: number;
  readonly mempoolDepth: number;
  readonly stateRoot: string;
  readonly uptimeMs: number;
}
export interface DaemonMetrics {
  readonly uptimeMs: number;
  readonly committedTicks: number; // ticks that carried ≥1 submission
  readonly idleTicks: number; // scheduler fires with an empty mempool
  readonly totalSubmissions: number;
  readonly maxMempoolDepth: number;
  readonly recoveryLatencyMs: number; // cold-start re-fold (the known ~2h/1M bound at scale)
  readonly shutdownLatencyMs: number;
  readonly tickLatencyMsAvg: number;
  readonly tickLatencyMsMax: number; // grows with history at this stage (O(n) re-fold) — PR-1.2 target
  readonly tickDriftMsMax: number; // scheduled vs actual fire time
  readonly lastStateRoot: string;
}

const agentIdOf = (s: Submission): string => {
  const a = (s.cal as { agent_id?: unknown } | null)?.agent_id;
  return typeof a === "string" ? a : "";
};

export class Pr1Daemon {
  private node!: OvtNode;
  private state: DaemonState = "STOPPED";
  private mempool: Submission[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private nextFireAt = 0;
  private m = { committedTicks: 0, idleTicks: 0, totalSubmissions: 0, maxMempoolDepth: 0, recoveryLatencyMs: 0, shutdownLatencyMs: 0, tickLatSum: 0, tickLatN: 0, tickLatMax: 0, driftMax: 0 };

  constructor(private readonly opts: { dir: string; genesisState: State; tickIntervalMs: number }) {}

  /** BOOTING → RECOVERING (cold re-fold from the WAL, measured) → CATCHING_UP → RUNNING. */
  start(): void {
    if (this.state !== "STOPPED") throw new Error(`cannot start from ${this.state}`);
    this.startedAt = Date.now();
    this.state = "BOOTING";

    this.state = "RECOVERING";
    const t0 = performance.now();
    this.node = OvtNode.open(this.opts.dir); // re-fold the committed WAL (empty on a fresh dir)
    this.m.recoveryLatencyMs = performance.now() - t0;

    // CATCHING_UP: drain any work queued before RUNNING (none on a fresh start; the state exists for
    // 1.1b/1.2 where recovery + backlog replay are real).
    this.state = "CATCHING_UP";

    this.state = "RUNNING";
    this.nextFireAt = Date.now() + this.opts.tickIntervalMs;
    this.timer = setInterval(() => this.onTick(), this.opts.tickIntervalMs);
  }

  /** Async intake: enqueue a submission (mempool). Accepted only while live. */
  submit(s: Submission): void {
    if (this.state !== "RUNNING" && this.state !== "CATCHING_UP") throw new Error(`not accepting submissions in ${this.state}`);
    this.mempool.push(s);
    this.m.totalSubmissions++;
    if (this.mempool.length > this.m.maxMempoolDepth) this.m.maxMempoolDepth = this.mempool.length;
  }

  /** One scheduler fire: drift, then drain ≤1 submission per agent (respecting §6.1 single-in-flight)
   * into a tick; commit it through the durable node. Extra per-agent submissions stay queued. */
  private onTick(): void {
    if (this.state !== "RUNNING") return;
    const now = Date.now();
    const drift = Math.abs(now - this.nextFireAt);
    if (drift > this.m.driftMax) this.m.driftMax = drift;
    this.nextFireAt += this.opts.tickIntervalMs;

    const batch = this.drainOnePerAgent();
    if (batch.length === 0) { this.m.idleTicks++; return; }
    const t0 = performance.now();
    this.node.submit(batch); // durable WAL + re-fold (O(n)/tick at this stage)
    const lat = performance.now() - t0;
    this.m.committedTicks++;
    this.m.tickLatN++; this.m.tickLatSum += lat; if (lat > this.m.tickLatMax) this.m.tickLatMax = lat;
  }

  private drainOnePerAgent(): Submission[] {
    const seen = new Set<string>();
    const batch: Submission[] = [];
    const keep: Submission[] = [];
    for (const s of this.mempool) {
      const a = agentIdOf(s);
      if (seen.has(a)) { keep.push(s); continue; } // a second CAL for this agent waits for the next tick
      seen.add(a);
      batch.push(s);
    }
    this.mempool = keep;
    return batch;
  }

  /** SHUTTING_DOWN: stop the clock, flush remaining mempool into a final tick, then STOPPED. */
  shutdown(): DaemonMetrics {
    const t0 = performance.now();
    this.state = "SHUTTING_DOWN";
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    while (this.mempool.length > 0) {
      const batch = this.drainOnePerAgent();
      if (batch.length === 0) break;
      this.node.submit(batch);
      this.m.committedTicks++;
    }
    this.m.shutdownLatencyMs = performance.now() - t0;
    this.state = "STOPPED";
    return this.metrics();
  }

  status(): DaemonStatus {
    return { state: this.state, committedTicks: this.node?.tickCount() ?? 0, mempoolDepth: this.mempool.length, stateRoot: this.node?.stateRoot() ?? "", uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0 };
  }

  metrics(): DaemonMetrics {
    return {
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      committedTicks: this.m.committedTicks,
      idleTicks: this.m.idleTicks,
      totalSubmissions: this.m.totalSubmissions,
      maxMempoolDepth: this.m.maxMempoolDepth,
      recoveryLatencyMs: this.m.recoveryLatencyMs,
      shutdownLatencyMs: this.m.shutdownLatencyMs,
      tickLatencyMsAvg: this.m.tickLatN ? this.m.tickLatSum / this.m.tickLatN : 0,
      tickLatencyMsMax: this.m.tickLatMax,
      tickDriftMsMax: this.m.driftMax,
      lastStateRoot: this.node?.stateRoot() ?? "",
    };
  }
}
