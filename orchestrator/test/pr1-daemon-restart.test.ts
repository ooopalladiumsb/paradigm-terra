/**
 * PR-1.1b — daemon crash / restart, the end-to-end process check of the recovery chain. Each element
 * (incremental runtime, snapshot+tail, SLA cadence) is already proven in isolation; this closes the loop
 *   RUNNING → crash → start() → restore(snapshot) → replay_tail → RUNNING
 * against three independent gates:
 *   Gate 1 (fidelity):     crashed+recovered == uninterrupted, on STATE_ROOT + GLOBAL_ROOT (the latter
 *                          binds eventCount + lastEventHash), i.e. the snapshot path == the full replay.
 *   Gate 2 (utilization):  the restart actually used SNAPSHOT_TAIL, not a silent FULL_REPLAY fallback.
 *   Gate 3 (SLA):          the recovered tail ≤ the cadence, and the modelled recovery ≤ the SLA.
 * Plus the worst case: a crash at the cadence boundary (maximal tail = N−1).
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
import { predictedRecoveryMs, RECOVERY_MARGIN_MS, RECOVERY_SLA_MS, REFERENCE_PER_TICK_RECOVERY_MS, REFERENCE_SNAPSHOT_LOAD_MS } from "../src/node/recovery-sla.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-1b-${tag}-`));
const fullRoot = (n: number) => run({ genesisState: fundedGenesis(), ticks: Array.from({ length: n }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] })) }).finalStateRoot;

/** Drive a single-agent daemon to exactly `target` committed ticks (one tick per fire), then return. */
async function driveTo(d: Pr1Daemon, target: number): Promise<void> {
  for (let i = 0; i < target; i++) d.submit(sendSub(BigInt(i + 1)));
  for (let i = 0; i < 4000 && d.status().committedTicks < target; i++) await sleep(2);
  assert.equal(d.status().committedTicks, target, "drove to the expected committed-tick count");
}

test("Gate1+2+3: crash mid-run → restart restores via snapshot+tail, identical to uninterrupted", async () => {
  const N = 10; // small cadence so a snapshot is taken and the test is fast
  const T = 47; // not a multiple of N ⇒ a non-empty tail at crash
  const dir = tmp("restart");
  OvtNode.create(dir, fundedGenesis()); // provision genesis + empty WAL

  const d1 = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d1.start();
  await driveTo(d1, T);
  d1.simulateCrash(); // abandon the process — only the durably-WAL'd T ticks survive

  // Gate 1 (fidelity): the snapshot+tail recovery == the uninterrupted full replay, on both roots
  const recovered = OvtNode.open(dir); // snapshot + tail
  const uninterrupted = OvtNode.open(dir, { ignoreSnapshots: true }); // == continuous execution
  assert.equal(recovered.stateRoot(), uninterrupted.stateRoot(), "STATE_ROOT: recovered == uninterrupted");
  assert.equal(recovered.eventLogRoot(), uninterrupted.eventLogRoot(), "GLOBAL_ROOT (binds eventCount+lastEventHash): recovered == uninterrupted");
  assert.equal(recovered.stateRoot(), fullRoot(T), "STATE_ROOT == independent full_replay(WAL)");

  // restart the daemon for real and check it comes up on the recovered state
  const d2 = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d2.start();
  const s = d2.status();
  assert.equal(s.state, "RUNNING", "restarted daemon is RUNNING");
  assert.equal(s.stateRoot, fullRoot(T), "restarted root == uninterrupted");

  // Gate 2 (utilization): the restart used the snapshot path, not a silent full re-fold
  assert.equal(s.recoveryMode, "SNAPSHOT_TAIL", "restart restored via snapshot + tail");

  // Gate 3 (SLA, model-based): tail ≤ cadence, and the modelled recovery is within the SLA
  assert.ok(s.recoveredTailTicks <= N, `recovered tail ${s.recoveredTailTicks} ≤ cadence ${N}`);
  assert.equal(s.recoveredTailTicks, T % N, "tail = ticks since the last cadence snapshot");
  const predicted = predictedRecoveryMs(s.recoveredTailTicks, REFERENCE_SNAPSHOT_LOAD_MS, REFERENCE_PER_TICK_RECOVERY_MS, RECOVERY_MARGIN_MS);
  assert.ok(predicted <= RECOVERY_SLA_MS, `predicted recovery ${predicted}ms ≤ SLA ${RECOVERY_SLA_MS}ms`);

  d2.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("worst case: crash at the cadence boundary → maximal tail (N−1), still faithful & within SLA", async () => {
  const N = 10;
  const T = 2 * N - 1; // last snapshot @ N ⇒ tail = N−1 (the maximum the cadence allows)
  const dir = tmp("maxtail");
  OvtNode.create(dir, fundedGenesis());

  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: N });
  d.start();
  await driveTo(d, T);
  d.simulateCrash();

  const recovered = OvtNode.open(dir);
  assert.equal(recovered.recoveryMode(), "SNAPSHOT_TAIL");
  assert.equal(recovered.recoveredTailTicks(), N - 1, "tail is the maximum the cadence permits");
  assert.ok(recovered.recoveredTailTicks() <= N, "still ≤ cadence");
  assert.equal(recovered.stateRoot(), fullRoot(T), "max-tail recovery is still byte-exact");
  assert.equal(recovered.stateRoot(), OvtNode.open(dir, { ignoreSnapshots: true }).stateRoot(), "== uninterrupted");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("restart after graceful shutdown restores with an EMPTY tail (instant restart)", async () => {
  const dir = tmp("graceful");
  OvtNode.create(dir, fundedGenesis());
  const d1 = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: 10 });
  d1.start();
  await driveTo(d1, 13);
  const root = d1.status().stateRoot;
  d1.shutdown(); // snapshots on the way out

  const d2 = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 3, snapshotCadence: 10 });
  d2.start();
  assert.equal(d2.status().recoveryMode, "SNAPSHOT_TAIL");
  assert.equal(d2.status().recoveredTailTicks, 0, "graceful shutdown ⇒ empty tail on restart");
  assert.equal(d2.status().stateRoot, root, "restart root == pre-shutdown root");
  d2.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});
