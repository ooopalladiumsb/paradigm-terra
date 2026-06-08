/**
 * PR-1.8 — live observer (closes H3.5-live). DoD:
 *   Gate 1: an external observer confirms a RUNNING node's published root (OBSERVED_OK), independently.
 *   Gate 2: the observer is never ahead of the node — it verifies the published checkpoint (lag ≤ poll).
 *   Gate 3: teeth — a lying / drifted published root is caught (OBSERVED_DRIFT).
 *   Gate 4: observe-only — observation writes nothing to the node directory.
 * (The cross-language form — an independent Go re-fold — is scripts/pr1-8-live-observer.mjs.)
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
import { LiveObserver } from "../src/node/live-observer.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-8-${tag}-`));
async function drive(d: Pr1Daemon, fromCommitted: number, toCommitted: number): Promise<void> {
  for (let n = fromCommitted + 1; n <= toCommitted; n++) d.submit(sendSub(BigInt(n)));
  for (let i = 0; i < 6000 && d.status().committedTicks < toCommitted; i++) await sleep(2);
  assert.equal(d.status().committedTicks, toCommitted);
}
const dirFingerprint = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) out[name] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
  return out;
};

test("Gate1+2: an external observer confirms a RUNNING node, never ahead of it", async () => {
  const dir = tmp("live");
  OvtNode.create(dir, fundedGenesis());
  const d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 4, snapshotCadence: 10 });
  d.start();
  const observer = new LiveObserver();

  await drive(d, 0, 15);
  let v = observer.observe(dir); // independent re-derivation from the node's dir
  assert.equal(v.status, "OBSERVED_OK", "observer confirms the live root");
  assert.equal(v.derivedStateRoot, v.claimedStateRoot);
  assert.equal(v.derivedGlobalRoot, v.claimedGlobalRoot);
  assert.equal(d.status().state, "RUNNING", "the node kept running through observation");
  assert.ok(v.observedTicks <= d.status().committedTicks, "observer is never ahead of the node");

  await drive(d, 15, 33); // node advances; observer re-confirms the new published checkpoint
  v = observer.observe(dir);
  assert.equal(v.status, "OBSERVED_OK");
  assert.equal(v.observedTicks, 33);
  assert.ok(v.observedTicks <= d.status().committedTicks);

  d.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate3: teeth — a drifted published root is caught", () => {
  const dir = tmp("teeth");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 12; i++) node.submit([sendSub(BigInt(i + 1))]); // quiescent node dir
  const observer = new LiveObserver();
  assert.equal(observer.observe(dir).status, "OBSERVED_OK", "matches before tampering");

  // a node that PUBLISHES a wrong root (corruption / a lying node) — the observer must catch it
  const headPath = path.join(dir, "head.json");
  const head = JSON.parse(fs.readFileSync(headPath, "utf8"));
  head.finalStateRoot = "0x" + "de".repeat(32);
  fs.writeFileSync(headPath, JSON.stringify(head));
  const v = observer.observe(dir);
  assert.equal(v.status, "OBSERVED_DRIFT", "independent re-derivation disagrees with the published root");
  assert.notEqual(v.derivedStateRoot, v.claimedStateRoot);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("Gate4: observe-only — observation writes nothing to the node directory", () => {
  const dir = tmp("readonly");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 14; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  const before = dirFingerprint(dir);
  const observer = new LiveObserver();
  for (let i = 0; i < 5; i++) observer.observe(dir); // repeated observation
  assert.deepEqual(dirFingerprint(dir), before, "the node directory is byte-for-byte unchanged by observation");
  fs.rmSync(dir, { recursive: true, force: true });
});
