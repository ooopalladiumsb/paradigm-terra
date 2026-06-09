/**
 * PR-1.2c-B — snapshot recovery wired through OvtNode on a real filesystem: write a snapshot, reopen,
 * and confirm the node restores from snapshot + WAL tail (not a full re-fold) to the SAME roots; plus
 * the two load-discipline rules — ahead-of-WAL is a hard abort, a checksum-bad snapshot is silently
 * skipped and the full WAL still recovers — and ≥2 retention. (The crash matrix proper is PR-1.2c-C.)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { applyTick, initIncremental, type Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { decodeSnapshot, encodeSnapshot, makeSnapshotBody, SnapshotCorruptionError } from "../src/node/snapshot.js";
import { listSnapshots, writeSnapshotFile } from "../src/node/snapshot-store.js";

const A = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = {
  currentTick: 0n,
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  operatorSigPresent: true,
  ownerSigPresent: true,
};
function fundedGenesis(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return {
    cal: {
      action: "wallet.send_ton",
      agent_id: A,
      nonce,
      expiration_tick: 10_000_000n,
      preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
      invariants: [],
      steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
    } as Json,
    trace: okTrace,
  };
}
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-2cB-${tag}-`));
function buildNode(dir: string, ticks: number): OvtNode {
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < ticks; i++) node.submit([sendSub(BigInt(i + 1))]);
  return node;
}
function incrAfter(k: number) {
  let incr = initIncremental(fundedGenesis());
  for (let i = 0; i < k; i++) incr = applyTick(incr, { tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] }).next;
  return incr;
}

test("recovery uses snapshot + tail (not full re-fold) and reaches the same roots", () => {
  const dir = tmp("uses");
  const node = buildNode(dir, 20);
  const liveRoot = node.stateRoot();
  const liveLogRoot = node.eventLogRoot();
  node.snapshot(); // covered_tick = 20, empty tail

  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), liveRoot, "snapshot-recovered STATE_ROOT == live");
  assert.equal(recovered.eventLogRoot(), liveLogRoot, "snapshot-recovered event-log root == live");
  assert.equal(recovered.tickCount(), 20, "tickCount reflects the full WAL");
  // proof the snapshot path was taken: the in-memory transcript holds only the (empty) tail, not all 20
  assert.equal(recovered.getTranscript().ticks.length, 0, "tail-only transcript ⇒ snapshot path used, no full re-fold");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("snapshot covering a PREFIX restores + replays the remaining tail to the same roots", () => {
  const dir = tmp("prefix");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 6; i++) node.submit([sendSub(BigInt(i + 1))]);
  node.snapshot(); // covers 6, wal_offset = WAL bytes @ tick 6
  for (let i = 6; i < 10; i++) node.submit([sendSub(BigInt(i + 1))]); // 4 more ticks appended after the snapshot

  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), node.stateRoot(), "restore(@6) + replay tail[6..10) == full");
  assert.equal(recovered.getTranscript().ticks.length, 4, "exactly the 4 tail ticks were replayed (tail-seek)");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("ahead-of-WAL snapshot is a HARD ABORT, not self-heal", () => {
  const dir = tmp("ahead");
  buildNode(dir, 5); // WAL has 5 ticks (~a few KB)
  // a checksum-VALID snapshot whose wal_offset (10 MB) exceeds the WAL size: write-model violation
  writeSnapshotFile(dir, makeSnapshotBody(incrAfter(1), 1n, 10_000_000n));

  assert.throws(() => OvtNode.open(dir), SnapshotCorruptionError, "ahead-of-WAL snapshot aborts the load");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("negative control: wal_offset bumped off a line boundary → detected (not a silent wrong recovery)", () => {
  const dir = tmp("offplus1");
  // prefix snapshot (covers 6, wal_offset < walSize) so +1 lands MID-LINE in the tail — isolating the
  // boundary check from the ahead-of-WAL check (which would fire if wal_offset exceeded the WAL).
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 6; i++) node.submit([sendSub(BigInt(i + 1))]);
  const file = node.snapshot();
  for (let i = 6; i < 12; i++) node.submit([sendSub(BigInt(i + 1))]);
  const liveRoot = node.stateRoot();
  // re-publish a CHECKSUM-VALID snapshot whose wal_offset is off by one byte (now mid-line, not after \n)
  const body = decodeSnapshot(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, encodeSnapshot({ ...body, wal_offset: body.wal_offset + 1n }));

  const recovered = OvtNode.open(dir); // boundary validation must fire → discard snapshot → full re-fold
  assert.equal(recovered.stateRoot(), liveRoot, "recovered correctly via the full WAL, NOT a silent empty tail");
  assert.equal(recovered.getTranscript().ticks.length, 12, "full re-fold ⇒ boundary check rejected the bad offset");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a checksum-bad snapshot is skipped; the full WAL still recovers (Rule 1 fallback)", () => {
  const dir = tmp("corrupt");
  const node = buildNode(dir, 8);
  const liveRoot = node.stateRoot();
  const file = node.snapshot(); // valid snapshot @ 8
  // corrupt the published snapshot's bytes (flip a char well inside the body)
  const bad = fs.readFileSync(file, "utf8");
  const idx = bad.indexOf('"body":"') + 40;
  fs.writeFileSync(file, bad.slice(0, idx) + (bad[idx] === "a" ? "b" : "a") + bad.slice(idx + 1));

  const recovered = OvtNode.open(dir); // must NOT throw — skip the bad snapshot, full re-fold
  assert.equal(recovered.stateRoot(), liveRoot, "fell back to the full WAL re-fold, same root");
  assert.equal(recovered.getTranscript().ticks.length, 8, "full re-fold ⇒ all 8 ticks in the transcript");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("retention keeps the newest ≥2 snapshots", () => {
  const dir = tmp("retain");
  const node = OvtNode.create(dir, fundedGenesis());
  const covered: bigint[] = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 3; i++) node.submit([sendSub(BigInt(r * 3 + i + 1))]);
    node.snapshot(2); // keep 2
    covered.push(BigInt(node.tickCount()));
  }
  const snaps = listSnapshots(dir);
  assert.equal(snaps.length, 2, "only 2 snapshots retained");
  assert.deepEqual(
    snaps.map((s) => s.coveredTick),
    [covered[3]!, covered[2]!],
    "the two newest covered_ticks are kept (newest first)",
  );
  // and recovery from the retained set still matches live
  assert.equal(OvtNode.open(dir).stateRoot(), node.stateRoot(), "recovery from retained snapshots == live");

  fs.rmSync(dir, { recursive: true, force: true });
});
