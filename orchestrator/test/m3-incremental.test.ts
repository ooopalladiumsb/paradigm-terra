/**
 * M3-A — incremental backup. SC-1 (chain equivalence): restore(base ⊕ deltas) == node@t, into a FRESH
 * directory, byte-for-byte on STATE_ROOT / GLOBAL_ROOT / EVENT_COUNT / LAST_EVENT_HASH (+ committed
 * ticks), and matching the chain-tip manifest on the recovery path. Plus negative controls so a chain
 * is a CONSISTENT state, not a pile of deltas: non-contiguous chain · tampered delta · missing delta.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import type { Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { backupNode } from "../src/node/backup.js";
import { backupBase, backupIncremental, restoreChain, BackupError } from "../src/node/backup-incremental.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `m3a-${tag}-`));
const advanceTo = (node: OvtNode, from: number, to: number) => {
  for (let i = from; i < to; i++) {
    node.submit([sendSub(BigInt(i + 1))]);
    node.maybeSnapshot(10);
  }
};

// One source node, captured as a chain: base@10 → inc1@20 → inc2@25 (cadence-10 snapshots, non-empty tail).
function buildChain() {
  const srcDir = tmp("src");
  const node = OvtNode.create(srcDir, fundedGenesis());
  advanceTo(node, 0, 10);
  const baseDir = tmp("base");
  backupBase(srcDir, baseDir, { snapshotCadence: 10 });
  advanceTo(node, 10, 20);
  const inc1 = tmp("inc1");
  backupIncremental(srcDir, [baseDir], inc1, { snapshotCadence: 10 });
  advanceTo(node, 20, 25);
  const inc2 = tmp("inc2");
  backupIncremental(srcDir, [baseDir, inc1], inc2, { snapshotCadence: 10 });
  return { srcDir, node, baseDir, inc1, inc2, obs: node.observe() };
}

test("SC-1: restore(base ⊕ deltas) reproduces node@t on all 7 quantities", () => {
  const c = buildChain();
  const rdir = tmp("rs");
  const r = restoreChain([c.baseDir, c.inc1, c.inc2], rdir).observe();

  assert.equal(r.stateRoot, c.obs.stateRoot, "STATE_ROOT");
  assert.equal(r.globalRoot, c.obs.globalRoot, "GLOBAL_ROOT");
  assert.equal(r.eventCount, c.obs.eventCount, "EVENT_COUNT");
  assert.equal(r.lastEventHash, c.obs.lastEventHash, "LAST_EVENT_HASH");
  assert.equal(r.committedTicks, c.obs.committedTicks, "committed ticks");
  assert.equal(r.recoveryMode, "SNAPSHOT_TAIL", "RECOVERY_MODE");
  assert.equal(String(r.committedTicks - r.recoveredTailTicks), "20", "COVERED_TICK (snapshot at 20, tail 5)");
});

test("SC-1: a base+deltas chain equals a single full backup of the same point", () => {
  const c = buildChain();
  const full = tmp("full");
  backupNode(c.srcDir, full, { snapshotCadence: 10 });
  const rChain = restoreChain([c.baseDir, c.inc1, c.inc2], tmp("rc")).observe();
  // the full backup's manifest expected == the chain restore's observed state
  const fm = JSON.parse(fs.readFileSync(path.join(full, "backup-manifest.json"), "utf8"));
  assert.equal(rChain.stateRoot, fm.expected.state_root, "chain == full backup STATE_ROOT");
  assert.equal(rChain.lastEventHash, fm.expected.last_event_hash, "chain == full backup LAST_EVENT_HASH");
});

test("negative: a non-contiguous chain (a delta skipped) is rejected", () => {
  const c = buildChain();
  assert.throws(() => restoreChain([c.baseDir, c.inc2], tmp("rs-gap")), (e) => e instanceof BackupError && /non-contiguous/.test(e.message));
});

test("negative: a tampered delta (size != manifest) is rejected", () => {
  const c = buildChain();
  fs.appendFileSync(path.join(c.inc1, "wal-delta.ndjson"), "{}\n"); // corrupt the delta bytes
  assert.throws(() => restoreChain([c.baseDir, c.inc1, c.inc2], tmp("rs-tamper")), (e) => e instanceof BackupError);
});

test("negative: a missing delta file is rejected", () => {
  const c = buildChain();
  fs.rmSync(path.join(c.inc1, "wal-delta.ndjson"));
  assert.throws(() => restoreChain([c.baseDir, c.inc1, c.inc2], tmp("rs-missing")), (e) => e instanceof BackupError && /missing its delta/.test(e.message));
});

test("empty delta: an incremental with no new ticks restores to the prior state", () => {
  const srcDir = tmp("src-empty");
  const node = OvtNode.create(srcDir, fundedGenesis());
  advanceTo(node, 0, 10);
  const baseDir = tmp("base-empty");
  backupBase(srcDir, baseDir, { snapshotCadence: 10 });
  const inc = tmp("inc-empty");
  const m = backupIncremental(srcDir, [baseDir], inc, { snapshotCadence: 10 }); // no advance ⇒ empty delta
  assert.equal(m.delta_bytes, 0, "delta is empty");
  const r = restoreChain([baseDir, inc], tmp("rs-empty")).observe();
  assert.equal(r.stateRoot, node.observe().stateRoot, "empty-delta restore == base state");
});
