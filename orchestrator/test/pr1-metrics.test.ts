/**
 * PR-1.4 — metrics, the observational layer over the proven operational kernel. DoD gates:
 *   Gate 1: key metrics update during live daemon operation.
 *   Gate 2: after restart, metrics restore and keep growing from the recovered state.
 *   Gate 3: metrics are OBSERVERS, never authorities — STATE_ROOT / GLOBAL_ROOT are identical with and
 *           without observing, across the OVT corpus (observing mutates nothing, affects no root).
 * Plus: estimated_recovery_budget_ms tracks the live tail (PR-1.3 model) — rises with the tail, drops
 * to the floor when a cadence snapshot fires.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, type Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { estimatedRecoveryBudgetMs } from "../src/node/metrics.js";
import { PROGRAMS } from "../scripts/programs.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-4-${tag}-`));
const fullRoot = (n: number) => run({ genesisState: fundedGenesis(), ticks: Array.from({ length: n }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] })) }).finalStateRoot;
/** Drive a single-agent daemon from `fromCommitted` to `toCommitted` committed ticks (one per fire). */
async function drive(d: Pr1Daemon, fromCommitted: number, toCommitted: number): Promise<void> {
  for (let n = fromCommitted + 1; n <= toCommitted; n++) d.submit(sendSub(BigInt(n)));
  for (let i = 0; i < 6000 && d.status().committedTicks < toCommitted; i++) await sleep(2);
  assert.equal(d.status().committedTicks, toCommitted, "drove to the expected committed-tick count");
}

test("Gate1: metrics update during live operation", async () => {
  const N = 10;
  const dir = tmp("live");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d.start();
  await drive(d, 0, 25); // snapshots at 10 and 20 ⇒ tail 5

  const r = d.metricsReport();
  // A + B
  assert.equal(r.observation.committedTicks, 25);
  assert.equal(r.observation.stateAgentCount, 1);
  assert.equal(r.observation.snapshotCount, 2, "snapshots at 10 and 20");
  assert.equal(r.observation.tailTicksSinceSnapshot, 5, "25 − 20");
  assert.ok(r.observation.walSizeBytes > 0);
  assert.equal(r.observation.stateRoot, fullRoot(25));
  // C — performance windows populated
  assert.ok(r.performance.tickDurationMs.n >= 25 && r.performance.tickDurationMs.max >= 0);
  assert.ok(r.performance.tickDriftMs.n > 0);
  assert.equal(r.performance.recoveryDurationMs >= 0, true);
  // computed budget = PR-1.3 model on the live tail
  assert.equal(r.estimatedRecoveryBudgetMs, estimatedRecoveryBudgetMs(5));

  d.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate2: after restart, metrics restore and grow from the recovered state", async () => {
  const N = 10;
  const dir = tmp("restart");
  OvtNode.create(dir, fundedGenesis());
  const d1 = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d1.start();
  await drive(d1, 0, 25);
  d1.simulateCrash();

  const d2 = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d2.start();
  const afterRestart = d2.metricsReport();
  assert.equal(afterRestart.observation.committedTicks, 25, "metrics restored to the recovered tick count");
  assert.equal(afterRestart.observation.recoveryMode, "SNAPSHOT_TAIL");
  assert.equal(afterRestart.observation.recoveredTailTicks, 5);
  assert.equal(afterRestart.observation.stateRoot, fullRoot(25));

  await drive(d2, 25, 30); // continue past the recovered base
  const grown = d2.metricsReport();
  assert.equal(grown.observation.committedTicks, 30, "counters grow from the recovered state, not from zero");
  assert.equal(grown.observation.stateRoot, fullRoot(30));

  d2.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate3: metrics are observers — observing changes no root, across the OVT corpus", () => {
  for (const { id, program } of PROGRAMS) {
    const dir = tmp("obs");
    const node = OvtNode.bulkCreate(dir, program.genesisState, program.ticks); // preserves the program's tick numbers
    const ref = run(program);
    const root0 = node.stateRoot();
    const g0 = node.eventLogRoot();
    // observe many times — a read-only metrics layer must not perturb anything
    for (let i = 0; i < 8; i++) node.observe();
    assert.equal(node.stateRoot(), root0, `${id}: STATE_ROOT unchanged by observation`);
    assert.equal(node.eventLogRoot(), g0, `${id}: GLOBAL_ROOT unchanged by observation`);
    // and the node still equals the canonical run (metrics did not alter consensus output)
    assert.equal(node.stateRoot(), ref.finalStateRoot, `${id}: STATE_ROOT == run()`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("estimated_recovery_budget_ms tracks the live tail and drops when a snapshot fires", async () => {
  const N = 10;
  const dir = tmp("budget");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d.start();

  await drive(d, 0, 9); // tail 9, no snapshot yet
  const b9 = d.metricsReport();
  assert.equal(b9.observation.tailTicksSinceSnapshot, 9);
  assert.equal(b9.estimatedRecoveryBudgetMs, estimatedRecoveryBudgetMs(9));

  await drive(d, 9, 10); // the cadence snapshot fires at 10 ⇒ tail resets to 0
  const b10 = d.metricsReport();
  assert.equal(b10.observation.tailTicksSinceSnapshot, 0);
  assert.ok(b10.estimatedRecoveryBudgetMs < b9.estimatedRecoveryBudgetMs, "budget drops to the floor after a snapshot");

  d.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});
