/**
 * PR-1.2c-A Gate A — the snapshot storage artifact, proven in isolation (no replay, no recovery, no
 * daemon). The single claim:
 *
 *   decode(encode(x)) == x   for x = { state, currentTick, eventCount, lastEventHash }
 *
 * with lastEventHash compared BYTE-FOR-BYTE. This catches the exact false positive PR-1.2b's
 * memory-only structuredClone round-trip could not: a plain JSON pass destroys the Uint8Array while
 * STATE_ROOT + eventCount still match. Plus checksum integrity (tamper => error) and version guard.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { toHex } from "@paradigm-terra/canonical";
import { applyTick, initIncremental, type IncrementalState, type Submission } from "../src/index.js";
import { decodeSnapshot, encodeSnapshot, makeSnapshotBody, SnapshotCorruptionError } from "../src/node/snapshot.js";

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
/** A real live state after `ticks` finalizing sends: eventCount>0, lastEventHash≠0, currentTick>0. */
function liveAfter(ticks: number): IncrementalState {
  let incr = initIncremental(fundedGenesis());
  for (let i = 0; i < ticks; i++) incr = applyTick(incr, { tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] }).next;
  return incr;
}
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

test("GateA: decode(encode(x)) == x on all four carried quantities, lastEventHash byte-for-byte", () => {
  const incr = liveAfter(5);
  assert.ok(incr.eventCount > 0 && incr.currentTick > 0n, "precondition: non-trivial live state");
  assert.ok(!incr.lastEventHash.every((b) => b === 0), "precondition: lastEventHash is not all-zero");

  const body = makeSnapshotBody(incr, 4n, 8192n);
  const round = decodeSnapshot(encodeSnapshot(body));

  assert.deepEqual(round.incr.state, incr.state, "state round-trips");
  assert.equal(round.incr.currentTick, incr.currentTick, "currentTick round-trips (bigint)");
  assert.equal(round.incr.eventCount, incr.eventCount, "eventCount round-trips");
  assert.equal(round.covered_tick, 4n, "covered_tick round-trips (bigint)");
  assert.equal(round.wal_offset, 8192n, "wal_offset round-trips (bigint)");
  assert.equal(round.snapshot_version, body.snapshot_version, "version round-trips");
  assert.equal(round.state_root, body.state_root, "state_root round-trips");
  assert.equal(round.event_log_root, body.event_log_root, "event_log_root round-trips");

  // the headline: lastEventHash preserved byte-for-byte, still a real Uint8Array of length 32
  assert.ok(round.incr.lastEventHash instanceof Uint8Array, "lastEventHash decodes to a Uint8Array");
  assert.equal(round.incr.lastEventHash.length, 32, "lastEventHash length preserved");
  assert.ok(bytesEqual(round.incr.lastEventHash, incr.lastEventHash), "lastEventHash byte-for-byte");
  assert.equal(toHex(round.incr.lastEventHash), toHex(incr.lastEventHash), "lastEventHash hex equal");
});

test("GateA: a naive JSON pass would corrupt lastEventHash — the codec is why it does not", () => {
  const incr = liveAfter(3);
  // naive: structuredClone-style memory round-trip is fine, but DISK JSON is not
  const naive = JSON.parse(JSON.stringify(incr, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.ok(!(naive.lastEventHash instanceof Uint8Array), "naive JSON loses the Uint8Array type (the defect class)");
  // the snapshot codec preserves it
  const ok = decodeSnapshot(encodeSnapshot(makeSnapshotBody(incr, 2n, 0n)));
  assert.ok(ok.incr.lastEventHash instanceof Uint8Array && bytesEqual(ok.incr.lastEventHash, incr.lastEventHash), "codec preserves it byte-for-byte");
});

test("GateA: genesis edge (eventCount 0, all-zero lastEventHash) round-trips", () => {
  const incr = initIncremental(fundedGenesis());
  assert.equal(incr.eventCount, 0);
  const round = decodeSnapshot(encodeSnapshot(makeSnapshotBody(incr, 0n, 0n)));
  assert.equal(round.incr.eventCount, 0);
  assert.ok(round.incr.lastEventHash instanceof Uint8Array && round.incr.lastEventHash.length === 32);
  assert.ok(bytesEqual(round.incr.lastEventHash, incr.lastEventHash), "all-zero lastEventHash byte-for-byte");
  assert.deepEqual(round.incr.state, incr.state);
});

test("GateA: a tampered byte fails the checksum (discardable corruption)", () => {
  const enc = encodeSnapshot(makeSnapshotBody(liveAfter(4), 3n, 0n));
  // flip one hex char inside the embedded body string (find a digit and bump it)
  const idx = enc.indexOf('"body":"') + 8 + 20;
  const tampered = enc.slice(0, idx) + (enc[idx] === "a" ? "b" : "a") + enc.slice(idx + 1);
  assert.notEqual(tampered, enc);
  assert.throws(() => decodeSnapshot(tampered), SnapshotCorruptionError, "checksum mismatch is raised");
});

test("GateA: an unsupported snapshot_version is rejected (even with a valid checksum)", () => {
  // hand-build an envelope at version 999 with a CORRECT checksum, to prove the version gate is
  // independent of the checksum gate.
  const body = makeSnapshotBody(liveAfter(2), 1n, 0n);
  const bad = encodeSnapshot({ ...body, snapshot_version: 999 });
  assert.throws(() => decodeSnapshot(bad), /unsupported snapshot_version 999/, "version gate fires");
});

test("GateA: malformed envelope (not our shape) is a corruption error, not a crash", () => {
  assert.throws(() => decodeSnapshot("{not json"), SnapshotCorruptionError);
  assert.throws(() => decodeSnapshot('{"checksum":"0x00"}'), SnapshotCorruptionError, "missing body");
});
