/**
 * Direct behavioural checks complementing the golden vectors: the happy-path
 * event sequence, and the design invariant that a pre-validation failure emits
 * no `cal.validated` (so the frozen reducer moves no PTRA — design §6).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validate, type ExecutionTrace, type Json } from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const CH = "0x" + "11".repeat(32);

function snapshot(nonce = 0n): Json {
  return {
    cal: { in_flight: {}, nonces: { [A]: nonce } },
    governance: { params: {} },
    ptra: { balances: { [A]: 10n ** 18n } },
    registry: { agents: { [A]: { granted_scopes: ["ton_transfer"] } } },
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

const trace: ExecutionTrace = {
  currentTick: 0n,
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  ownerSigPresent: true,
};

test("happy path emits validated→executed→settled→finalized", () => {
  const r = validate(cal(), CH, snapshot(), trace);
  assert.equal(r.terminalStage, "FINALIZED");
  assert.equal(r.reasonCode, null);
  assert.deepEqual(
    r.events.map((e) => e["event_type"]),
    ["cal.validated", "cal.executed", "cal.settled", "cal.finalized"],
  );
});

test("pre-validation failure emits no cal.validated (reducer moves no PTRA)", () => {
  const r = validate(cal(), CH, snapshot(5n), trace); // expects nonce 6, cal has 1
  assert.equal(r.terminalStage, "FAILED");
  assert.equal(r.reasonCode, "NONCE_MISMATCH");
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0]!["event_type"], "cal.failed");
  assert.ok(!r.events.some((e) => e["event_type"] === "cal.validated"));
});
