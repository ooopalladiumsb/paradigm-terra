// A1-1 — Long-duration soak program. Composes the proven PR-1.9 SoakMonitor (consensus / recovery /
// growth / operational, per sample) and ADDS the A1 long-run checks the charter pins:
//   SC-1 duration   — the run must cover a target wall-clock window with zero violations
//   SC-4 durability  — snapshot+restore equivalence holds throughout (periodic backup→restore == live)
//   SC-6 resource    — memory / fd / disk show no degradation (fd-leak + disk-runaway rate ceilings)
// Observe-only, like SoakMonitor: it measures and reports; it never acts on the node and never touches
// the Freeze Surface. SoakMonitor itself is unmodified (its PR-1.9 tests stand) — this composes it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MetricsReport } from "./metrics.js";
import { SoakMonitor, type SoakConfig, type SoakReport, type SoakSampleExtra } from "./soak.js";
import { backupNode, restoreNode } from "./backup.js";

/** The state quantities restore-equivalence (SC-4) checks — the Backup-Equivalence subset. */
export interface LiveRoots {
  readonly stateRoot: string;
  readonly globalRoot: string;
  readonly eventCount: number;
  readonly lastEventHash: string;
  readonly committedTicks: number;
}

export interface A1Violation {
  readonly class: "durability" | "resource" | "duration";
  readonly detail: string;
  readonly atMs: number;
}

export interface ResourceSample {
  readonly fds: number;
  readonly diskBytes: number;
  readonly heapBytes: number;
  readonly atMs: number;
}

export interface A1Config extends SoakConfig {
  readonly targetDurationMs?: number; // SC-1: the run must cover at least this wall-clock window
  readonly fdRateCeilPerSec?: number; // SC-6: fds must not grow (a leak); default 0.5/s
  readonly diskRateCeilBytesPerSec?: number; // SC-6: disk must not run away; default 1 MiB/s
}

export interface A1SoakReport {
  readonly ok: boolean;
  readonly base: SoakReport;
  readonly a1Violations: readonly A1Violation[];
  readonly durationMs: number;
  readonly targetDurationMs: number;
  readonly durationMet: boolean;
  readonly restoreChecks: number;
  readonly resource: {
    readonly samples: number;
    readonly maxFds: number;
    readonly fdRatePerSec: number;
    readonly maxDiskBytes: number;
    readonly diskBytesPerSec: number;
    readonly heapBytesPerSec: number;
  };
}

/** Count this process's open file descriptors (Linux /proc); 0 if unavailable (the check then no-ops). */
export function countOpenFds(): number {
  try {
    return fs.readdirSync("/proc/self/fd").length;
  } catch {
    return 0;
  }
}

/** On-disk footprint of a node directory (WAL + snapshots + genesis + any archive/delta files). */
export function dirBytes(dir: string): number {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isFile()) total += st.size;
  }
  return total;
}

export class SoakProgram {
  private readonly inner: SoakMonitor;
  private readonly targetMs: number;
  private readonly fdCeil: number;
  private readonly diskCeil: number;
  private readonly a1: A1Violation[] = [];
  private readonly resources: ResourceSample[] = [];
  private restores = 0;
  private firstMs = 0;
  private lastMs = 0;

  constructor(cfg: A1Config = {}) {
    this.inner = new SoakMonitor(cfg);
    this.targetMs = cfg.targetDurationMs ?? 0;
    this.fdCeil = cfg.fdRateCeilPerSec ?? 0.5;
    this.diskCeil = cfg.diskRateCeilBytesPerSec ?? 1024 * 1024;
  }

  /** Per-sample: forward the PR-1.9 invariant checks unchanged. */
  record(report: MetricsReport, extra: SoakSampleExtra = {}): void {
    const at = extra.nowMs ?? Date.now();
    if (this.firstMs === 0) this.firstMs = at;
    this.lastMs = at;
    this.inner.record(report, extra);
  }

  /** SC-6: record a memory / fd / disk sample (cheap; call alongside record()). */
  sampleResources(s: ResourceSample): void {
    if (this.firstMs === 0) this.firstMs = s.atMs;
    this.lastMs = s.atMs;
    this.resources.push(s);
  }

  /**
   * SC-4: take a backup of the (quiescent) live node dir, restore it into scratch, and assert the
   * restored roots equal the live node's. Records a `durability` violation on any mismatch. The caller
   * quiesces the node first (as PR-1.9 does before sampling). Returns true iff equivalent.
   */
  checkRestoreEquivalence(nodeDir: string, live: LiveRoots, atMs: number = Date.now()): boolean {
    this.restores++;
    const bdir = fs.mkdtempSync(path.join(os.tmpdir(), "a1-bk-"));
    const rdir = fs.mkdtempSync(path.join(os.tmpdir(), "a1-rs-"));
    try {
      backupNode(nodeDir, bdir);
      const r = restoreNode(bdir, rdir).observe();
      const ok =
        r.stateRoot === live.stateRoot &&
        r.globalRoot === live.globalRoot &&
        r.eventCount === live.eventCount &&
        r.lastEventHash === live.lastEventHash &&
        r.committedTicks === live.committedTicks;
      if (!ok) this.a1.push({ class: "durability", detail: `restore != live (state_root ${r.stateRoot} vs ${live.stateRoot})`, atMs });
      return ok;
    } catch (e) {
      this.a1.push({ class: "durability", detail: `restore-equivalence check failed: ${e instanceof Error ? e.message : String(e)}`, atMs });
      return false;
    } finally {
      fs.rmSync(bdir, { recursive: true, force: true });
      fs.rmSync(rdir, { recursive: true, force: true });
    }
  }

  noteRestart(): void {
    this.inner.noteRestart();
  }

  report(): A1SoakReport {
    const base = this.inner.report();
    const durationMs = Math.max(0, this.lastMs - this.firstMs);
    const durationMet = this.targetMs === 0 || durationMs >= this.targetMs;

    const first = this.resources[0];
    const last = this.resources[this.resources.length - 1];
    const spanSec = first && last ? Math.max(1e-3, (last.atMs - first.atMs) / 1000) : 1;
    const fdRate = first && last ? (last.fds - first.fds) / spanSec : 0;
    const diskRate = first && last ? (last.diskBytes - first.diskBytes) / spanSec : 0;
    const heapRate = first && last ? (last.heapBytes - first.heapBytes) / spanSec : 0;

    // durability violations are accumulated during checks (this.a1); resource/duration are derived here
    // without mutating state, so report() is idempotent.
    const derived: A1Violation[] = [];
    const lastAt = last?.atMs ?? this.lastMs;
    if (this.resources.length >= 2 && fdRate > this.fdCeil) derived.push({ class: "resource", detail: `fd growth ${fdRate.toFixed(2)}/s > ceil ${this.fdCeil}/s (leak)`, atMs: lastAt });
    if (this.resources.length >= 2 && diskRate > this.diskCeil) derived.push({ class: "resource", detail: `disk growth ${(diskRate / 1024).toFixed(1)} KiB/s > ceil ${(this.diskCeil / 1024).toFixed(0)} KiB/s (runaway)`, atMs: lastAt });
    if (!durationMet) derived.push({ class: "duration", detail: `run ${(durationMs / 1000).toFixed(1)}s < target ${(this.targetMs / 1000).toFixed(1)}s`, atMs: this.lastMs });
    const a1Violations = [...this.a1, ...derived];

    return {
      ok: base.ok && a1Violations.length === 0 && durationMet,
      base,
      a1Violations,
      durationMs,
      targetDurationMs: this.targetMs,
      durationMet,
      restoreChecks: this.restores,
      resource: {
        samples: this.resources.length,
        maxFds: this.resources.reduce((m, s) => Math.max(m, s.fds), 0),
        fdRatePerSec: fdRate,
        maxDiskBytes: this.resources.reduce((m, s) => Math.max(m, s.diskBytes), 0),
        diskBytesPerSec: diskRate,
        heapBytesPerSec: heapRate,
      },
    };
  }
}
