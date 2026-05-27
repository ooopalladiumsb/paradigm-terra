/**
 * Gas pricing / escrow / settle semantics.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canValidate,
  effectsBytes,
  escrowRequirement,
  gasUnits,
  mcpCallUnits,
  settle,
  staticGasUnits,
  toNano,
  type Json,
} from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";

function cal(extra: Record<string, Json> = {}): Json {
  return {
    cal_version: "0.1.0",
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {} }],
    receipt_required: true,
    signatures: { operator_sig: "0x" + "ab".repeat(64) },
    ...extra,
  };
}
function state(balance: bigint): Json {
  return {
    governance: { gas_price_nano_ptra_per_unit: 1000n, params: {} },
    ptra: { balances: { [A]: balance } },
  } as Json;
}

test("MCP call class: get_* read (50), else write (200)", () => {
  assert.equal(mcpCallUnits("wallet.send_ton"), 200n);
  assert.equal(mcpCallUnits("oracles.get_feed"), 50n);
});

test("static gas = precondition DSL cost + step write call (no invariants/posts)", () => {
  // gte(1) + var path state.ptra.balances.<addr> (4 segments → 8) = 9; + 1 write step (200) = 209
  assert.equal(staticGasUnits(cal()), 209n);
});

test("total gas adds state rent (1 per byte)", () => {
  assert.equal(gasUnits(cal(), 80n), 209n + 80n);
  assert.equal(toNano(289n, 1000n), 289000n);
});

test("effectsBytes counts canonical bytes of the committed delta", () => {
  const effects = [{ ns: "treasury", op: "add", path: ["nav"], value: 1000n }];
  assert.ok(effectsBytes(effects as Json) > 0n);
});

test("escrow = flat fee + max-expected gas; gas_limit_ptra overrides the default", () => {
  assert.equal(escrowRequirement(cal(), state(10n ** 12n)), 100000n + 100000n * 100n); // default fee×100
  assert.equal(escrowRequirement(cal({ gas_limit_ptra: 7n }), state(10n ** 12n)), 100000n + 7n);
});

test("canValidate gates on covering the full escrow (§9.3)", () => {
  assert.equal(canValidate(cal(), state(10n ** 12n)), true);
  assert.equal(canValidate(cal(), state(1n)), false);
});

test("settle: each bill is internally consistent (charge = fee + consumed)", () => {
  for (const o of ["FINALIZED", "FAILED_EXEC", "FAILED_PRECOND", "FAILED_NO_CHARGE", "EXPIRED_POST"] as const) {
    const b = settle(o, cal(), state(10n ** 12n), 80n);
    assert.equal(b.totalAgentCharge, b.feeRetained + b.dynamicGasConsumed, `${o}: charge`);
  }
});

test("settle: EXPIRED_PRE and FAILED_NO_CHARGE move no PTRA (§9.1 ingress-class)", () => {
  const st = state(10n ** 12n);
  for (const o of ["EXPIRED_PRE", "FAILED_NO_CHARGE"] as const) {
    const b = settle(o, cal(), st, 80n);
    assert.deepEqual([b.feeRetained, b.dynamicGasConsumed, b.gasRefunded, b.totalAgentCharge], [0n, 0n, 0n, 0n], o);
  }
});

test("settle FAILED_PRECOND (§9.4 spam): full fee charged, nothing escrowed", () => {
  // ample balance → full flat fee retained; no escrow was taken, so gasRefunded = 0.
  const b = settle("FAILED_PRECOND", cal(), state(10n ** 12n), 80n);
  assert.equal(b.feeRetained, 100000n);
  assert.equal(b.dynamicGasConsumed, 0n);
  assert.equal(b.gasRefunded, 0n);
  assert.equal(b.totalAgentCharge, 100000n);
});

test("settle FAILED_PRECOND: spam charge capped at balance (min(fee, balance))", () => {
  // balance below the flat fee (the §9.3 escrow gate runs after precond/capability):
  // charge what is there, never more.
  const b = settle("FAILED_PRECOND", cal(), state(30000n), 80n);
  assert.equal(b.feeRetained, 30000n);
  assert.equal(b.totalAgentCharge, 30000n);
  assert.equal(b.gasRefunded, 0n);
});

test("settle EXPIRED_POST: fee already escrowed at cal.validated; max gas refunded", () => {
  const b = settle("EXPIRED_POST", cal(), state(10n ** 12n), 80n);
  assert.equal(b.dynamicGasConsumed, 0n);
  assert.equal(b.totalAgentCharge, 100000n); // flat fee only
  assert.equal(b.gasRefunded, 100000n * 100n); // full max gas refunded
});

test("settle FINALIZED: refund = maxGas − consumed; charge = fee + consumed", () => {
  const b = settle("FINALIZED", cal(), state(10n ** 12n), 80n);
  const consumed = toNano(gasUnits(cal(), 80n), 1000n);
  assert.equal(b.dynamicGasConsumed, consumed);
  assert.equal(b.gasRefunded, 100000n * 100n - consumed);
  assert.equal(b.totalAgentCharge, 100000n + consumed);
});
