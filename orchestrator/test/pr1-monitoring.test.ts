/**
 * PR-1.5 — monitoring / drift-watch. DoD gates:
 *   Gate 1: the health model reflects the node's state (HEALTHY / DEGRADED / UNHEALTHY).
 *   Gate 2: the recovery-SLA watch reacts to a growing tail and clears after a snapshot.
 *   Gate 3: growth-watch records wal/state/heap rates without touching consensus.
 *   Gate 4: drift-watch has TEETH — it detects an artificially injected TS↔oracle divergence.
 * Monitoring is pure & observational throughout ("monitoring observes, consensus decides").
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, type Submission } from "../src/index.js";
import { OvtNode, type NodeObservation } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import type { MetricsReport } from "../src/node/metrics.js";
import { detectDrift, GrowthWatch, nodeHealth, slaWatch, type Checkpoint } from "../src/node/monitoring.js";
import { RECOVERY_SLA_MS } from "../src/node/recovery-sla.js";

// ---- helpers ------------------------------------------------------------------------------------
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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-5-${tag}-`));
async function drive(d: Pr1Daemon, fromCommitted: number, toCommitted: number): Promise<void> {
  for (let n = fromCommitted + 1; n <= toCommitted; n++) d.submit(sendSub(BigInt(n)));
  for (let i = 0; i < 6000 && d.status().committedTicks < toCommitted; i++) await sleep(2);
  assert.equal(d.status().committedTicks, toCommitted);
}
const stat = (max = 0) => ({ last: max, avg: max, max, n: 1 });
const baseObs: NodeObservation = { stateRoot: "0x0", globalRoot: "0x0", eventCount: 0, lastEventHash: "0x0", currentTick: 0n, recoveryMode: "FRESH", recoveredTailTicks: 0, committedTicks: 0, stateAgentCount: 1, walSizeBytes: 0, snapshotCount: 0, tailTicksSinceSnapshot: 0 };
function mkReport(over: { budget?: number; driftMax?: number; obs?: Partial<NodeObservation> }): MetricsReport {
  return {
    observation: { ...baseObs, ...over.obs },
    performance: { tickDurationMs: stat(), tickDriftMs: stat(over.driftMax ?? 0), submitLatencyMs: stat(), snapshotDurationMs: stat(), recoveryDurationMs: 0 },
    estimatedRecoveryBudgetMs: over.budget ?? 0,
  };
}

test("Gate1: node health classification (HEALTHY / DEGRADED / UNHEALTHY)", () => {
  assert.equal(nodeHealth(mkReport({ budget: 5_000, driftMax: 0 })).status, "HEALTHY");
  assert.equal(nodeHealth(mkReport({ budget: 5_000, driftMax: 800 })).status, "DEGRADED", "drift ≥ warn");
  assert.equal(nodeHealth(mkReport({ budget: 5_000, driftMax: 3_000 })).status, "UNHEALTHY", "drift ≥ crit");
  assert.equal(nodeHealth(mkReport({ budget: RECOVERY_SLA_MS, driftMax: 0 })).status, "UNHEALTHY", "SLA violated");
  assert.equal(nodeHealth(mkReport({ budget: RECOVERY_SLA_MS * 0.85, driftMax: 0 })).status, "DEGRADED", "SLA at risk");
  const u = nodeHealth(mkReport({ budget: RECOVERY_SLA_MS, driftMax: 3_000 }));
  assert.equal(u.status, "UNHEALTHY");
  assert.ok(u.reasons.length >= 2, "reasons name each failing signal");
});

test("Gate1: a normally-running daemon is HEALTHY", async () => {
  const dir = tmp("healthy");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: 10 });
  d.start();
  await drive(d, 0, 15);
  const rep = d.metricsReport();
  // SLA dimension is deterministic (small tail ⇒ tiny budget); drift is environment-sensitive (the 3ms
  // test interval is deliberately faster than a ~16ms fold), so use generous drift thresholds here —
  // default thresholds are exercised in the pure classification test above.
  assert.equal(slaWatch(rep).status, "SLA_OK", "a normal short run is within the SLA");
  assert.equal(nodeHealth(rep, { driftWarnMs: 10_000, driftCritMs: 30_000 }).status, "HEALTHY");
  d.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate2: SLA watch — thresholds + reacts to tail, clears after a snapshot", async () => {
  // thresholds (pure)
  assert.equal(slaWatch(mkReport({ budget: 5_000 })).status, "SLA_OK");
  assert.equal(slaWatch(mkReport({ budget: RECOVERY_SLA_MS * 0.85 })).status, "SLA_AT_RISK");
  assert.equal(slaWatch(mkReport({ budget: RECOVERY_SLA_MS })).status, "SLA_VIOLATED");

  // live: the budget rises with the tail, then drops when the cadence snapshot fires
  const dir = tmp("sla");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: 10 });
  d.start();
  await drive(d, 0, 9);
  const atTail9 = slaWatch(d.metricsReport());
  await drive(d, 9, 10); // snapshot at 10 ⇒ tail 0
  const afterSnap = slaWatch(d.metricsReport());
  assert.ok(afterSnap.budgetMs < atTail9.budgetMs, "budget cleared after the snapshot");
  assert.equal(atTail9.status, "SLA_OK", "small tail is well within the SLA");
  assert.equal(afterSnap.status, "SLA_OK");
  d.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate3: growth watch records rates without touching consensus", async () => {
  // rates (pure, deterministic timestamps)
  const gw = new GrowthWatch();
  gw.sample(mkReport({ obs: { walSizeBytes: 100, stateAgentCount: 1, eventCount: 0 } }), 1000, 0);
  gw.sample(mkReport({ obs: { walSizeBytes: 1100, stateAgentCount: 3, eventCount: 60 } }), 2000, 1000);
  const r = gw.rates();
  assert.equal(r.samples, 2);
  assert.equal(r.walBytesPerSec, 1000);
  assert.equal(r.agentsPerSec, 2);
  assert.equal(r.eventsPerSec, 60);
  assert.equal(r.heapBytesPerSec, 1000);

  // observer rule: sampling growth changes no root
  const dir = tmp("growth");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: 10 });
  d.start();
  await drive(d, 0, 12);
  const root = d.status().stateRoot;
  const gw2 = new GrowthWatch();
  for (let i = 0; i < 5; i++) gw2.sample(d.metricsReport(), process.memoryUsage().heapUsed);
  assert.equal(d.status().stateRoot, root, "growth sampling did not change the state root");
  d.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate4: drift-watch has teeth — detects an injected divergence", () => {
  const program = { genesisState: fundedGenesis(), ticks: Array.from({ length: 6 }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] })) };
  const t = run(program);
  const ts: Checkpoint[] = t.ticks.map((tk) => ({ tick: tk.tick, stateRoot: tk.stateRoot, globalRoot: tk.globalMerkleRoot }));

  // matching oracle ⇒ no drift
  const ok = detectDrift(ts, ts.map((c) => ({ ...c })));
  assert.equal(ok.status, "DRIFT_OK");
  assert.equal(ok.checked, ts.length);

  // injected stateRoot divergence at tick 3 ⇒ detected, located
  const tamperedState = ts.map((c, i) => (i === 3 ? { ...c, stateRoot: "0x" + "de".repeat(32) } : { ...c }));
  const d1 = detectDrift(ts, tamperedState);
  assert.equal(d1.status, "DRIFT_DETECTED");
  assert.equal(d1.firstDivergence?.field, "stateRoot");
  assert.equal(d1.firstDivergence?.tick, ts[3]!.tick);

  // injected globalRoot divergence ⇒ detected
  const tamperedGlobal = ts.map((c, i) => (i === 1 ? { ...c, globalRoot: "0x" + "ad".repeat(32) } : { ...c }));
  assert.equal(detectDrift(ts, tamperedGlobal).firstDivergence?.field, "globalRoot");

  // length mismatch ⇒ detected
  assert.equal(detectDrift(ts, ts.slice(0, 4)).status, "DRIFT_DETECTED");
});
