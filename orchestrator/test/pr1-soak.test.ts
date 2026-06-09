/**
 * PR-1.9 — soak harness, the final readiness gate (behaviour over time). Purely evidential: it observes
 * / measures / records / reports, never changes the system. CI runs a short ACCELERATED soak (a real
 * daemon, sampled across a crash/restart) and asserts every invariant held; the multi-day run is
 * operational (scripts/pr1-9-soak.mjs). Teeth: the monitor must FLAG an injected invariant breach.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import type { Submission } from "../src/index.js";
import type { NodeObservation } from "../src/node/persistent-node.js";
import type { MetricsReport } from "../src/node/metrics.js";
import type { DriftResult } from "../src/node/monitoring.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { LiveObserver } from "../src/node/live-observer.js";
import { SoakMonitor } from "../src/node/soak.js";

const A = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {} as Json, stateAfter: {} as Json, operatorSigPresent: true, ownerSigPresent: true };
function fundedGenesis(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return { cal: { action: "wallet.send_ton", agent_id: A, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] } as Json, trace: okTrace };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-9-${tag}-`));
async function drive(d: Pr1Daemon, fromCommitted: number, toCommitted: number): Promise<void> {
  for (let n = fromCommitted + 1; n <= toCommitted; n++) d.submit(sendSub(BigInt(n)));
  for (let i = 0; i < 8000 && d.status().committedTicks < toCommitted; i++) await sleep(2);
  assert.equal(d.status().committedTicks, toCommitted);
}
const stat = (max = 0) => ({ last: max, avg: max, max, n: 1 });
const baseObs: NodeObservation = { stateRoot: "0x0", globalRoot: "0x0", eventCount: 0, lastEventHash: "0x0", currentTick: 0n, recoveryMode: "FRESH", recoveredTailTicks: 0, committedTicks: 0, stateAgentCount: 1, walSizeBytes: 0, snapshotCount: 0, tailTicksSinceSnapshot: 0 };
const mkReport = (over: { budget?: number; obs?: Partial<NodeObservation> }): MetricsReport => ({
  observation: { ...baseObs, ...over.obs },
  performance: { tickDurationMs: stat(), tickDriftMs: stat(), submitLatencyMs: stat(), snapshotDurationMs: stat(), recoveryDurationMs: 0 },
  estimatedRecoveryBudgetMs: over.budget ?? 0,
});

test("accelerated soak: invariants hold across a crash/restart (real daemon)", async () => {
  const N = 10;
  const dir = tmp("soak");
  OvtNode.create(dir, fundedGenesis());
  // scheduler-drift bound generous: the accelerated harness perturbs its own scheduling via synchronous
  // observe() sampling, and tick interval is small — the soak proves consensus/recovery/growth, while
  // recovery-sla / ts-go-drift criticals (which matter) still escalate.
  const mon = new SoakMonitor({ cadence: N, alertThresholds: { driftWarnMs: 5_000, driftCritMs: 60_000 } });
  const obs = new LiveObserver();
  const sample = (d: Pr1Daemon) => mon.record(d.metricsReport(), { observer: obs.observe(dir), heapBytes: process.memoryUsage().heapUsed, nowMs: Date.now() });

  let d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 25, snapshotCadence: N });
  d.start();
  await drive(d, 0, 20); sample(d);
  await drive(d, 20, 40); sample(d);

  // a crash/restart inside the soak — long-lived systems restart; the gate must survive it
  d.simulateCrash();
  mon.noteRestart();
  d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 25, snapshotCadence: N });
  d.start();
  assert.equal(d.status().recoveryMode, "SNAPSHOT_TAIL", "restart restored via snapshot+tail");
  await drive(d, 40, 60); sample(d);
  d.shutdown();

  const r = mon.report();
  assert.ok(r.ok, `soak invariants held: ${JSON.stringify(r.violations)}`);
  assert.equal(r.restarts, 1);
  assert.equal(r.committedTicks, 60, "state advanced continuously across the restart");
  assert.ok(r.maxTailTicks <= N, "tail stayed within cadence throughout");
  assert.ok(r.maxBudgetMs <= 60_000, "recovery budget stayed within the SLA throughout");
  assert.equal(r.maxStateAgents, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("teeth: the soak monitor flags injected invariant breaches", () => {
  // consensus breach: a drift detection
  const m1 = new SoakMonitor({ cadence: 10 });
  const drift: DriftResult = { status: "DRIFT_DETECTED", checked: 1, firstDivergence: { tick: 1n, field: "stateRoot", ts: "0xaa", oracle: "0xbb" } };
  m1.record(mkReport({ budget: 5_000 }), { drift });
  let r = m1.report();
  assert.equal(r.ok, false);
  assert.equal(r.violations[0]!.class, "consensus");

  // recovery breach: tail beyond cadence
  const m2 = new SoakMonitor({ cadence: 10 });
  m2.record(mkReport({ budget: 5_000, obs: { tailTicksSinceSnapshot: 999 } }));
  assert.equal(m2.report().ok, false);
  assert.equal(m2.report().violations[0]!.class, "recovery");

  // recovery breach: budget over SLA
  const m3 = new SoakMonitor({ cadence: 10 });
  m3.record(mkReport({ budget: 99_999 }));
  assert.equal(m3.report().violations.some((v) => v.class === "recovery"), true);

  // growth breach: snapshot retention exceeded
  const m4 = new SoakMonitor({ cadence: 10, snapshotRetention: 2 });
  m4.record(mkReport({ budget: 5_000, obs: { snapshotCount: 9 } }));
  assert.equal(m4.report().violations.some((v) => v.class === "growth"), true);

  // a clean sample ⇒ ok (no false positives)
  const m5 = new SoakMonitor({ cadence: 10 });
  m5.record(mkReport({ budget: 5_000, obs: { tailTicksSinceSnapshot: 3, snapshotCount: 2 } }), { drift: { status: "DRIFT_OK", checked: 5 } });
  assert.equal(m5.report().ok, true);
});
