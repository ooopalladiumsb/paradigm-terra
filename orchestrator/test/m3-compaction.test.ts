/**
 * M3-B — WAL archival / compaction. SC-2: replay-from-compacted == replay-from-full (identical roots),
 * with the live WAL bounded (only the tail) and the covered prefix archived byte-exactly. Plus negative
 * controls: a corrupt rebased snapshot degrades gracefully to a full replay over archive ⊕ tail; a
 * tampered archive is rejected; nothing-to-compact fails loudly.
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
import { compactNode, restoreCompacted, replayFromFull, BackupError } from "../src/node/wal-compaction.js";

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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `m3b-${tag}-`));

// One source node: 25 ticks, cadence-10 snapshots at 10 & 20 ⇒ compact behind tick 20, tail = 5.
function buildSrc() {
  const srcDir = tmp("src");
  const node = OvtNode.create(srcDir, fundedGenesis());
  for (let i = 0; i < 25; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  return { srcDir, obs: node.observe(), wal: fs.readFileSync(path.join(srcDir, "wal.ndjson")) };
}

test("SC-2: restore-from-compacted reproduces the original roots (snapshot + tail)", () => {
  const s = buildSrc();
  const cdir = tmp("c");
  compactNode(s.srcDir, cdir);
  const r = restoreCompacted(cdir, tmp("rc")).observe();
  assert.equal(r.stateRoot, s.obs.stateRoot, "STATE_ROOT");
  assert.equal(r.globalRoot, s.obs.globalRoot, "GLOBAL_ROOT");
  assert.equal(r.eventCount, s.obs.eventCount, "EVENT_COUNT");
  assert.equal(r.lastEventHash, s.obs.lastEventHash, "LAST_EVENT_HASH");
  assert.equal(r.committedTicks, s.obs.committedTicks, "committed ticks");
  assert.equal(r.recoveryMode, "SNAPSHOT_TAIL", "fast path uses the rebased snapshot");
});

test("SC-2: replay-from-full (archive ⊕ tail) == replay-from-compacted == original", () => {
  const s = buildSrc();
  const cdir = tmp("c");
  compactNode(s.srcDir, cdir);
  const full = replayFromFull(cdir, tmp("rf")).observe();
  const comp = restoreCompacted(cdir, tmp("rc")).observe();
  assert.equal(full.stateRoot, comp.stateRoot, "full == compacted STATE_ROOT");
  assert.equal(full.stateRoot, s.obs.stateRoot, "full == original STATE_ROOT");
  assert.equal(full.lastEventHash, s.obs.lastEventHash, "full == original LAST_EVENT_HASH");
  assert.equal(full.recoveryMode, "FULL_REPLAY", "replay-from-full uses no snapshot");
});

test("SC-2: bounded live WAL + byte-exact archive split", () => {
  const s = buildSrc();
  const cdir = tmp("c");
  const m = compactNode(s.srcDir, cdir);
  assert.ok(m.live_wal_bytes < m.original_wal_bytes, "live WAL is bounded below the original");
  assert.equal(m.archive_bytes + m.live_wal_bytes, m.original_wal_bytes, "archive + live == original (no bytes lost)");
  const archive = fs.readFileSync(path.join(cdir, "wal-archive.ndjson"));
  const live = fs.readFileSync(path.join(cdir, "wal.ndjson"));
  assert.deepEqual(Buffer.concat([archive, live]), s.wal, "archive ⊕ live tail == the original WAL, byte-for-byte");
});

test("negative: a corrupt rebased snapshot degrades gracefully to archive ⊕ tail", () => {
  const s = buildSrc();
  const cdir = tmp("c");
  compactNode(s.srcDir, cdir);
  const snap = fs.readdirSync(cdir).find((n) => /^snapshot-\d+\.json$/.test(n))!;
  fs.writeFileSync(path.join(cdir, snap), '{"checksum":"deadbeef","body":"{}"}'); // corrupt it
  const r = restoreCompacted(cdir, tmp("rc")).observe();
  assert.equal(r.stateRoot, s.obs.stateRoot, "fallback still reproduces the state");
  assert.equal(r.recoveryMode, "FULL_REPLAY", "fell back to the archive ⊕ tail full replay");
});

test("negative: a tampered archive is rejected", () => {
  const s = buildSrc();
  const cdir = tmp("c");
  compactNode(s.srcDir, cdir);
  fs.appendFileSync(path.join(cdir, "wal-archive.ndjson"), "{}\n"); // archive size != manifest
  assert.throws(() => replayFromFull(cdir, tmp("rf")), (e) => e instanceof BackupError && /archive\/live size/.test(e.message));
});

test("negative: nothing to compact (no snapshot) fails loudly", () => {
  const srcDir = tmp("src-nosnap");
  const node = OvtNode.create(srcDir, fundedGenesis());
  for (let i = 0; i < 5; i++) node.submit([sendSub(BigInt(i + 1))]); // no maybeSnapshot ⇒ no snapshot
  assert.throws(() => compactNode(srcDir, tmp("c")), (e) => e instanceof BackupError && /no valid snapshot/.test(e.message));
});
