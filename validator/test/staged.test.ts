/**
 * Gate #3 — staged validator. Proves the lifecycle can be split across ticks so the
 * two previously-unreachable terminal states become reachable, and that the atomic
 * validate() is the exact composition of the two stages.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validate, validateToValidated, resumeFromValidated, type ExecutionTrace, type Json } from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const CH = "0x" + "11".repeat(32);

function snapshot(nonce = 0n): Json {
  return {
    cal: { in_flight: {}, nonces: { [A]: nonce } },
    governance: { params: {} },
    ptra: { balances: { [A]: 10n ** 18n } },
    registry: { agents: { [A]: { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) } } },
  } as Json;
}
function cal(): Json {
  return {
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
  } as Json;
}
const traceAt = (tick: bigint): ExecutionTrace => ({
  currentTick: tick,
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  operatorSigPresent: true,
  ownerSigPresent: true,
});
const types = (es: readonly Json[]) => es.map((e) => (e as Record<string, Json>)["event_type"]);
const ser = (es: readonly Json[]) => JSON.stringify(es, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));

test("validateToValidated leaves the CAL at VALIDATED (cal.validated, no terminal)", () => {
  const s1 = validateToValidated(cal(), CH, snapshot(), traceAt(0n));
  assert.equal(s1.terminal, null);
  assert.deepEqual(types(s1.events), ["cal.validated"]);
});

test("resumeFromValidated at tick <= expiration → FINALIZED", () => {
  const r = resumeFromValidated(cal(), CH, snapshot(), traceAt(0n));
  assert.equal(r.terminalStage, "FINALIZED");
  assert.deepEqual(types(r.events), ["cal.executed", "cal.settled", "cal.finalized"]);
});

test("resumeFromValidated at tick > expiration → EXPIRED_POST (now reachable)", () => {
  const r = resumeFromValidated(cal(), CH, snapshot(), traceAt(101n));
  assert.equal(r.terminalStage, "EXPIRED");
  assert.equal(r.reasonCode, null);
  assert.deepEqual(types(r.events), ["cal.expired"]);
  assert.match(r.reasonDetail, /after VALIDATED/);
});

test("atomic validate() == validateToValidated ++ resumeFromValidated (same tick), byte-for-byte", () => {
  const c = cal(), snap = snapshot(), tr = traceAt(0n);
  const s1 = validateToValidated(c, CH, snap, tr);
  const s2 = resumeFromValidated(c, CH, snap, tr);
  const atomic = validate(c, CH, snap, tr);
  assert.equal(s1.terminal, null);
  assert.equal(ser(atomic.events), ser([...s1.events, ...s2.events]));
});

test("validateToValidated surfaces a pre-validation failure as terminal (no cal.validated)", () => {
  const s1 = validateToValidated(cal(), CH, snapshot(5n), traceAt(0n)); // nonce mismatch (expects 6, cal has 1)
  assert.notEqual(s1.terminal, null);
  assert.equal(s1.terminal!.terminalStage, "FAILED");
  assert.equal(s1.terminal!.reasonCode, "NONCE_MISMATCH");
  assert.deepEqual(types(s1.events), ["cal.failed"]);
});
