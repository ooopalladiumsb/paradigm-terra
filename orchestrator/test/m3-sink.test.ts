/**
 * M3-C — remote backup sink. SC-3: backup → sink → restore reproduces node@t against a local sink (the
 * offline stand-in for "remote"; a real provider is the same async interface, gated). Covers a full
 * backup, an incremental chain, and a compacted set, plus negative controls (empty namespace · a
 * tampered sink object).
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
import { backupNode, restoreNode } from "../src/node/backup.js";
import { backupBase, backupIncremental, restoreChain } from "../src/node/backup-incremental.js";
import { compactNode, restoreCompacted } from "../src/node/wal-compaction.js";
import { LocalDirSink, pushDir, pullDir, BackupError } from "../src/node/backup-sink.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `m3c-${tag}-`));
const srcNode = (ticks: number) => {
  const dir = tmp("src");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < ticks; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  return { dir, obs: node.observe() };
};
const sameState = (r: ReturnType<OvtNode["observe"]>, o: ReturnType<OvtNode["observe"]>) => {
  assert.equal(r.stateRoot, o.stateRoot, "STATE_ROOT");
  assert.equal(r.globalRoot, o.globalRoot, "GLOBAL_ROOT");
  assert.equal(r.eventCount, o.eventCount, "EVENT_COUNT");
  assert.equal(r.lastEventHash, o.lastEventHash, "LAST_EVENT_HASH");
  assert.equal(r.committedTicks, o.committedTicks, "committed ticks");
};

test("SC-3: full backup → sink → restore == node@t", async () => {
  const s = srcNode(25);
  const bdir = tmp("bk");
  backupNode(s.dir, bdir, { snapshotCadence: 10 });
  const sink = new LocalDirSink(tmp("sink"));
  await pushDir(bdir, sink, "full");
  const pulled = tmp("pull");
  await pullDir(sink, "full", pulled);
  sameState(restoreNode(pulled, tmp("rs")).observe(), s.obs);
});

test("SC-3: incremental chain → sink → restore == node@t", async () => {
  const dir = tmp("src-chain");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 10; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  const baseDir = tmp("base");
  backupBase(dir, baseDir, { snapshotCadence: 10 });
  for (let i = 10; i < 20; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  const inc1 = tmp("inc1");
  backupIncremental(dir, [baseDir], inc1, { snapshotCadence: 10 });
  for (let i = 20; i < 25; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  const inc2 = tmp("inc2");
  backupIncremental(dir, [baseDir, inc1], inc2, { snapshotCadence: 10 });

  const sink = new LocalDirSink(tmp("sink"));
  await pushDir(baseDir, sink, "base");
  await pushDir(inc1, sink, "inc1");
  await pushDir(inc2, sink, "inc2");
  const pb = tmp("pb"), p1 = tmp("p1"), p2 = tmp("p2");
  await pullDir(sink, "base", pb);
  await pullDir(sink, "inc1", p1);
  await pullDir(sink, "inc2", p2);
  sameState(restoreChain([pb, p1, p2], tmp("rs")).observe(), node.observe());
});

test("SC-3: compacted set → sink → restore == node@t", async () => {
  const s = srcNode(25);
  const cdir = tmp("c");
  compactNode(s.dir, cdir);
  const sink = new LocalDirSink(tmp("sink"));
  await pushDir(cdir, sink, "comp");
  const pulled = tmp("pull");
  await pullDir(sink, "comp", pulled);
  sameState(restoreCompacted(pulled, tmp("rs")).observe(), s.obs);
});

test("negative: pulling an empty namespace fails", async () => {
  const sink = new LocalDirSink(tmp("sink"));
  await assert.rejects(() => pullDir(sink, "nope", tmp("rs")), (e) => e instanceof BackupError && /no objects/.test(e.message));
});

test("negative: a tampered sink object yields an inconsistent restore", async () => {
  const s = srcNode(25);
  const bdir = tmp("bk");
  backupNode(s.dir, bdir, { snapshotCadence: 10 });
  const sinkRoot = tmp("sink");
  const sink = new LocalDirSink(sinkRoot);
  await pushDir(bdir, sink, "full");
  // tamper the stored manifest so its expected state no longer matches the (clean) WAL it ships with.
  const mPath = path.join(sinkRoot, "full", "backup-manifest.json");
  const m = JSON.parse(fs.readFileSync(mPath, "utf8"));
  m.expected.state_root = "0x" + "00".repeat(32);
  fs.writeFileSync(mPath, JSON.stringify(m));
  const pulled = tmp("pull");
  await pullDir(sink, "full", pulled);
  assert.throws(() => restoreNode(pulled, tmp("rs")), (e) => e instanceof BackupError && /does not match the manifest/.test(e.message));
});
