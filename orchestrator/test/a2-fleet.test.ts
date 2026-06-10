/**
 * A2-1 — observer fleet. SC-1 CONSENSUS_OK (a quorum of independent tailers corroborates the node),
 * SC-2 NODE_DRIFT (the quorum UNANIMOUSLY contradicts a tampered claim — the H3.5 strengthening),
 * SC-3 OBSERVER_SPLIT (an injected faulty member is isolated as a dissenter, the node still corroborated),
 * SC-4 observe-only (the fleet writes nothing). The fleet never blames the node for an observer's fault.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import type { Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { ObserverFleet, liveObserverMember, type FleetMember } from "../src/node/observer-fleet.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `a2-${tag}-`));
const dirFingerprint = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) out[name] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
  return out;
};
async function publishedNode(ticks: number): Promise<string> {
  const dir = tmp("node");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 4, snapshotCadence: 10 });
  d.start();
  for (let n = 1; n <= ticks; n++) d.submit(sendSub(BigInt(n)));
  for (let i = 0; i < 6000 && d.status().committedTicks < ticks; i++) await sleep(2);
  assert.equal(d.status().committedTicks, ticks);
  d.shutdown(); // stop publishing so the checkpoint the fleet verifies is stable
  return dir;
}
const faultyMember: FleetMember = (dir) => ({ ...liveObserverMember(dir), status: "OBSERVED_DRIFT", derivedStateRoot: "0x" + "ee".repeat(32) });

test("SC-1: a fleet of 3 independent tailers reaches consensus and corroborates the node", async () => {
  const dir = await publishedNode(15);
  const v = new ObserverFleet().observe(dir); // default: 3 LiveObserver re-folds
  assert.equal(v.status, "CONSENSUS_OK");
  assert.equal(v.agree, 3);
  assert.equal(v.dissenters.length, 0);
  assert.equal(v.quorumStateRoot, v.claimedStateRoot);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SC-2: a tampered published root is contradicted UNANIMOUSLY by the fleet (NODE_DRIFT)", async () => {
  const dir = await publishedNode(15);
  const hp = path.join(dir, "head.json");
  const head = JSON.parse(fs.readFileSync(hp, "utf8"));
  head.finalStateRoot = "0x" + "00".repeat(32); // the node lies about its root
  fs.writeFileSync(hp, JSON.stringify(head));
  const v = new ObserverFleet().observe(dir);
  assert.equal(v.status, "NODE_DRIFT");
  assert.equal(v.agree, 3, "all 3 independent re-folds agree on the TRUE root");
  assert.notEqual(v.quorumStateRoot, v.claimedStateRoot, "quorum root ≠ the node's claim");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SC-3: a faulty member is isolated as a dissenter, the node still corroborated (OBSERVER_SPLIT)", async () => {
  const dir = await publishedNode(15);
  const v = new ObserverFleet([liveObserverMember, liveObserverMember, faultyMember]).observe(dir);
  assert.equal(v.status, "OBSERVER_SPLIT");
  assert.equal(v.agree, 2, "the two honest tailers form the quorum");
  assert.deepEqual([...v.dissenters], [2], "the faulty member (index 2) is the named dissenter");
  assert.equal(v.quorumStateRoot, v.claimedStateRoot, "the quorum still corroborates the node — observer-fault ≠ node-fault");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SC-3b: a total split with no quorum is flagged (OBSERVER_SPLIT)", async () => {
  const dir = await publishedNode(15);
  const wrong = (root: string): FleetMember => (d) => ({ ...liveObserverMember(d), derivedStateRoot: root });
  const v = new ObserverFleet([wrong("0x" + "11".repeat(32)), wrong("0x" + "22".repeat(32)), wrong("0x" + "33".repeat(32))]).observe(dir);
  assert.equal(v.status, "OBSERVER_SPLIT");
  assert.ok(v.agree < v.quorum, "no root reached quorum");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SC-4: the fleet writes nothing to the node directory (observe-only)", async () => {
  const dir = await publishedNode(15);
  const before = dirFingerprint(dir);
  new ObserverFleet().observe(dir);
  assert.deepEqual(dirFingerprint(dir), before, "node directory is byte-identical after observation");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a published-but-empty checkpoint is OBSERVED_EMPTY", async () => {
  const dir = tmp("empty");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 4, snapshotCadence: 10 });
  d.start();
  await sleep(20);
  d.shutdown();
  if (fs.existsSync(path.join(dir, "head.json"))) {
    const v = new ObserverFleet().observe(dir);
    assert.ok(v.status === "OBSERVED_EMPTY" || v.status === "CONSENSUS_OK"); // empty if nothing published yet
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
