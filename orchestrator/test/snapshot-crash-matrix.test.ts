/**
 * PR-1.2c-C — crash matrix: crash safety of the snapshot PUBLICATION PROTOCOL. Recovery Equivalence
 * is already proven (PR-1.2c-B); this stage proves only the transitions between on-disk states are
 * safe. The central invariant, for EVERY admissible crash point:
 *
 *   open()  →  either  (1) state == full_replay(committed WAL)
 *                or     (2) a deterministic refusal (SnapshotCorruptionError)
 *           →  NEVER   (3) start with a wrong state.
 *
 * Each crash point is simulated as the exact on-disk state a crash there would leave, then open() is
 * run against it. Write protocol under test:  append WAL · fsync WAL · write tmp · fsync tmp · rename.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { applyTick, initIncremental, run, type Submission, type TickBlock } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { encodeSnapshot, makeSnapshotBody, SnapshotCorruptionError } from "../src/node/snapshot.js";
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
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-2cC-${tag}-`));
const blocks = (n: number): TickBlock[] => Array.from({ length: n }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] }));
/** The reference: a clean full replay of the committed WAL, independent of OvtNode. */
const fullRoot = (n: number): string => run({ genesisState: fundedGenesis(), ticks: blocks(n) }).finalStateRoot;
function buildNode(dir: string, n: number): OvtNode {
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < n; i++) node.submit([sendSub(BigInt(i + 1))]);
  return node;
}
/** An IncrementalState after folding the first k blocks (for hand-built snapshots). */
function incrAfter(k: number) {
  let incr = initIncremental(fundedGenesis());
  for (const b of blocks(k)) incr = applyTick(incr, b).next;
  return incr;
}
const walPath = (dir: string) => path.join(dir, "wal.ndjson");

test("row1 — crash before any snapshot: WAL only → full re-fold == full_replay", () => {
  const dir = tmp("row1");
  buildNode(dir, 12);
  assert.equal(listSnapshots(dir).length, 0, "no snapshot present");
  assert.equal(OvtNode.open(dir).stateRoot(), fullRoot(12));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("row2 — crash mid snapshot write (partial .tmp, nothing published) → .tmp ignored, full re-fold", () => {
  const dir = tmp("row2");
  buildNode(dir, 12);
  fs.writeFileSync(path.join(dir, "snapshot-12.json.tmp"), '{"checksum":"0xdead","body":"{trunc'); // partial
  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), fullRoot(12), "ignored the partial tmp; recovered from WAL");
  assert.equal(recovered.getTranscript().ticks.length, 12, "full re-fold (no published snapshot used)");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("row3 — crash after fsync(tmp) before rename (COMPLETE .tmp, unpublished) → still ignored", () => {
  const dir = tmp("row3");
  buildNode(dir, 12);
  // a fully-valid snapshot, but left as .tmp (the rename never happened)
  fs.writeFileSync(path.join(dir, "snapshot-12.json.tmp"), encodeSnapshot(makeSnapshotBody(incrAfter(12), 12n)));
  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), fullRoot(12), "an unpublished (.tmp) snapshot is never used");
  assert.equal(recovered.getTranscript().ticks.length, 12, "full re-fold");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("row4 — crash after rename, before next WAL append (C == T) → restore(C) + empty tail", () => {
  const dir = tmp("row4");
  const node = buildNode(dir, 12);
  node.snapshot(); // published snapshot-12, no further WAL
  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), fullRoot(12));
  assert.equal(recovered.getTranscript().ticks.length, 0, "empty tail (snapshot path)");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("row5 — crash after WAL append+fsync, before next snapshot (C < T) → restore(C) + replay tail", () => {
  const dir = tmp("row5");
  buildNode(dir, 12); // WAL has 12
  writeSnapshotFile(dir, makeSnapshotBody(incrAfter(7), 7n)); // last snapshot only covered 7
  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), fullRoot(12), "restore(@7) + replay tail [7..12) == full");
  assert.equal(recovered.getTranscript().ticks.length, 5, "exactly the 5 tail ticks replayed");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("row6 — crash mid WAL append (torn trailing line) → drop torn line, recover the committed prefix", () => {
  const dir = tmp("row6");
  buildNode(dir, 10);
  fs.appendFileSync(walPath(dir), '{"tick":{"$bigint":"10"},"submi'); // torn 11th line, no newline
  // (a) no snapshot: full re-fold of the surviving prefix
  assert.equal(OvtNode.open(dir).stateRoot(), fullRoot(10), "torn line dropped; prefix recovered");
  // (b) with a snapshot at 6 (≤ surviving 10): restore + replay surviving tail
  writeSnapshotFile(dir, makeSnapshotBody(incrAfter(6), 6n));
  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), fullRoot(10), "snapshot@6 + tail[6..10] over the surviving WAL");
  assert.equal(recovered.getTranscript().ticks.length, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("forbidden state — a published snapshot newer than the WAL is a HARD ABORT (never wrong state)", () => {
  const dir = tmp("forbidden");
  buildNode(dir, 5);
  writeSnapshotFile(dir, makeSnapshotBody(incrAfter(5), 99n)); // covered_tick 99 > 5 committed
  assert.throws(() => OvtNode.open(dir), SnapshotCorruptionError, "deterministic refusal, not branch (3)");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("operational degradation — latest snapshot corrupt, previous valid → roll back + replay tail", () => {
  const dir = tmp("rollback");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 6; i++) node.submit([sendSub(BigInt(i + 1))]);
  node.snapshot(); // valid snapshot-6
  for (let i = 6; i < 12; i++) node.submit([sendSub(BigInt(i + 1))]);
  const latest = node.snapshot(); // valid snapshot-12 …which we now corrupt on disk
  const bytes = fs.readFileSync(latest, "utf8");
  const idx = bytes.indexOf('"body":"') + 40;
  fs.writeFileSync(latest, bytes.slice(0, idx) + (bytes[idx] === "a" ? "b" : "a") + bytes.slice(idx + 1));

  assert.equal(listSnapshots(dir).length, 2, "both snapshots present (12 corrupt, 6 valid)");
  const recovered = OvtNode.open(dir); // must NOT throw: skip corrupt 12, use valid 6
  assert.equal(recovered.stateRoot(), fullRoot(12), "rolled back to snapshot-6 + replayed tail [6..12)");
  assert.equal(recovered.getTranscript().ticks.length, 6, "tail of 6 ticks replayed from the older snapshot");
  fs.rmSync(dir, { recursive: true, force: true });
});
