// PR-1.1a/b — daemon: the node as a long-running PROCESS, not a batch fold. Operations layer, ABOVE the
// Freeze Surface — it wraps `OvtNode` and adds lifecycle, a wall-clock tick driver, an async submission
// mempool, and an observation surface. No network / p2p / RPC / monitoring (later PR-1 stages).
//
// PR-1.1b closes the crash/restart loop against the FINAL recovery pipeline: the tick loop snapshots on
// a cadence (maybeSnapshot ⇒ PR-1.3 SLA), graceful shutdown snapshots, and a restart recovers via
// snapshot + WAL tail (PR-1.2c/1.3-A). The daemon exposes recovery diagnostics (mode + tail) so a
// restart can be checked against the real criterion: recovered state == uninterrupted AND recovery ≤ SLA.
// (Per-tick latency is now O(tick), not O(history) — the 1.2b incremental applyTick removed that wall.)

import { OvtNode, type RecoveryMode } from "./persistent-node.js";
import { OPERATIONAL_CADENCE_TICKS } from "./recovery-sla.js";
import { estimatedRecoveryBudgetMs, Window, type MetricsReport } from "./metrics.js";
import type { Submission, Program } from "../index.js";

type State = NonNullable<Program["genesisState"]>;
export type DaemonState = "BOOTING" | "RECOVERING" | "CATCHING_UP" | "RUNNING" | "SHUTTING_DOWN" | "STOPPED";

export interface DaemonStatus {
  readonly state: DaemonState;
  readonly committedTicks: number;
  readonly mempoolDepth: number;
  readonly stateRoot: string;
  readonly uptimeMs: number;
  readonly recoveryMode: RecoveryMode; // how this process obtained its state at start (PR-1.1b Gate 2)
  readonly recoveredTailTicks: number; // WAL tail replayed at start (PR-1.1b Gate 3, vs the cadence)
}
export interface DaemonMetrics {
  readonly uptimeMs: number;
  readonly committedTicks: number; // ticks that carried ≥1 submission
  readonly idleTicks: number; // scheduler fires with an empty mempool
  readonly totalSubmissions: number;
  readonly maxMempoolDepth: number;
  readonly recoveryLatencyMs: number; // cold-start: snapshot + WAL tail replay (PR-1.2c/1.3-A)
  readonly shutdownLatencyMs: number;
  readonly tickLatencyMsAvg: number;
  readonly tickLatencyMsMax: number; // O(tick), flat vs history (PR-1.2b incremental applyTick)
  readonly tickDriftMsMax: number; // scheduled vs actual fire time
  readonly snapshotsTaken: number; // cadence + graceful-shutdown snapshots published (PR-1.1b)
  readonly recoveryMode: RecoveryMode;
  readonly recoveredTailTicks: number;
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
  private m = { committedTicks: 0, idleTicks: 0, totalSubmissions: 0, maxMempoolDepth: 0, recoveryLatencyMs: 0, shutdownLatencyMs: 0, tickLatSum: 0, tickLatN: 0, tickLatMax: 0, driftMax: 0, snapshotsTaken: 0 };
  // PR-1.4 class-C performance windows (bounded; observational only).
  private win = { tickDur: new Window(), tickDrift: new Window(), submitLat: new Window(), snapDur: new Window() };

  constructor(private readonly opts: { dir: string; genesisState: State; tickIntervalMs: number; snapshotCadence?: number }) {}

  /** Snapshot cadence (committed ticks between snapshots). Defaults to the PR-1.3 SLA-derived value. */
  private get cadence(): number {
    return this.opts.snapshotCadence ?? OPERATIONAL_CADENCE_TICKS;
  }

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
    const t0 = performance.now();
    this.mempool.push(s);
    this.m.totalSubmissions++;
    if (this.mempool.length > this.m.maxMempoolDepth) this.m.maxMempoolDepth = this.mempool.length;
    this.win.submitLat.add(performance.now() - t0);
  }

  /** One scheduler fire: drift, then drain ≤1 submission per agent (respecting §6.1 single-in-flight)
   * into a tick; commit it through the durable node. Extra per-agent submissions stay queued. */
  private onTick(): void {
    if (this.state !== "RUNNING") return;
    const now = Date.now();
    const drift = Math.abs(now - this.nextFireAt);
    this.win.tickDrift.add(drift);
    if (drift > this.m.driftMax) this.m.driftMax = drift;
    this.nextFireAt += this.opts.tickIntervalMs;

    const batch = this.drainOnePerAgent();
    if (batch.length === 0) { this.m.idleTicks++; return; }
    const t0 = performance.now();
    this.node.submit(batch); // durable WAL + incremental applyTick (O(tick))
    const tickMs = performance.now() - t0;
    this.win.tickDur.add(tickMs);
    const s0 = performance.now();
    if (this.node.maybeSnapshot(this.cadence)) { this.m.snapshotsTaken++; this.win.snapDur.add(performance.now() - s0); } // SLA cadence (PR-1.3-B)
    this.m.committedTicks++;
    this.m.tickLatN++; this.m.tickLatSum += tickMs; if (tickMs > this.m.tickLatMax) this.m.tickLatMax = tickMs;
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

  /** SHUTTING_DOWN: stop the clock, flush remaining mempool into final ticks, snapshot (so the next
   *  start restores with an empty tail — instant restart), then STOPPED. */
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
    this.node.snapshot(); // graceful-shutdown snapshot (PR-1.2a §3): next restart has an empty tail
    this.m.snapshotsTaken++;
    this.m.shutdownLatencyMs = performance.now() - t0;
    this.state = "STOPPED";
    return this.metrics();
  }

  /** Fault injection (tests): simulate a crash — stop the clock and abandon the process WITHOUT
   *  flushing the mempool or snapshotting. Only the durably-WAL'd committed ticks survive; the next
   *  start() must recover to exactly those (PR-1.1b Gate 1). NOT a graceful path. */
  simulateCrash(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.mempool = [];
    this.state = "STOPPED";
  }

  status(): DaemonStatus {
    return {
      state: this.state,
      committedTicks: this.node?.tickCount() ?? 0,
      mempoolDepth: this.mempool.length,
      stateRoot: this.node?.stateRoot() ?? "",
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      recoveryMode: this.node?.recoveryMode() ?? "FRESH",
      recoveredTailTicks: this.node?.recoveredTailTicks() ?? 0,
    };
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
      snapshotsTaken: this.m.snapshotsTaken,
      recoveryMode: this.node?.recoveryMode() ?? "FRESH",
      recoveredTailTicks: this.node?.recoveredTailTicks() ?? 0,
      lastStateRoot: this.node?.stateRoot() ?? "",
    };
  }

  /** PR-1.4 metrics surface: observation (A correctness-adjacent + B capacity) + performance (C) + the
   *  live recovery budget. Purely observational — reading it mutates nothing and affects no root. */
  metricsReport(): MetricsReport {
    const observation = this.node.observe();
    return {
      observation,
      performance: {
        tickDurationMs: this.win.tickDur.stat(),
        tickDriftMs: this.win.tickDrift.stat(),
        submitLatencyMs: this.win.submitLat.stat(),
        snapshotDurationMs: this.win.snapDur.stat(),
        recoveryDurationMs: this.m.recoveryLatencyMs,
      },
      estimatedRecoveryBudgetMs: estimatedRecoveryBudgetMs(observation.tailTicksSinceSnapshot),
    };
  }
}
