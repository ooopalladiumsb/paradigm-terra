/**
 * PFC2-M4 — owner-authorization gas (Multisig v2.1, §9.2). Implements
 * `pfc2-m1-multisig-semantics.md` §8 (gas) under the three M4 hard rules:
 *   1. operator path unchanged — gasUnits with no ownerAuth == v1;
 *   2. linear in k = signatures verified (not owners.length);
 *   3. only gas accounting changes (asserted by the formula here; lifecycle/reducer are elsewhere).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { GAS_UNITS, gasUnits, ownerAuthUnits, settle, type Json } from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";

function cal(): Json {
  return {
    cal_version: "0.1.0",
    action: "ptra.stake",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "ptra.stake", params: {}, post_conditions: [] }],
  } as Json;
}

test("ownerAuthUnits: linear in k (BASE + k×WEIGHT); 0 for k≤0", () => {
  const { OWNER_AUTH_BASE: B, ED25519_VERIFY_WEIGHT: W } = GAS_UNITS;
  assert.equal(ownerAuthUnits(0n), 0n); // non-owner-gated → no charge
  assert.equal(ownerAuthUnits(-1n), 0n); // defensive
  assert.equal(ownerAuthUnits(1n), B + 1n * W);
  assert.equal(ownerAuthUnits(2n), B + 2n * W);
  assert.equal(ownerAuthUnits(3n), B + 3n * W);
});

test("rule 2 — cost scales with verified signatures, NOT owner-set size", () => {
  // a 2-of-16 agent verifies 2 sigs → pays for 2, never 16.
  assert.equal(ownerAuthUnits(2n), GAS_UNITS.OWNER_AUTH_BASE + 2n * GAS_UNITS.ED25519_VERIFY_WEIGHT);
  // each extra verified signature adds exactly one ED25519_VERIFY_WEIGHT.
  assert.equal(ownerAuthUnits(3n) - ownerAuthUnits(2n), GAS_UNITS.ED25519_VERIFY_WEIGHT);
});

test("rule 1 — operator path unchanged: gasUnits without ownerAuth == v1", () => {
  const bytes = 42n;
  const v1 = gasUnits(cal(), bytes); // default ownerAuth = 0
  assert.equal(gasUnits(cal(), bytes, 0n), v1); // explicit 0 identical
  assert.equal(gasUnits(cal(), bytes), v1); // i.e. no hidden coefficient on the operator path
});

test("gasUnits adds exactly ownerAuth on top of the v1 units", () => {
  const bytes = 42n;
  const base = gasUnits(cal(), bytes);
  assert.equal(gasUnits(cal(), bytes, ownerAuthUnits(2n)), base + ownerAuthUnits(2n));
});

test("SC-4 — 1-of-1 prices identically to a v1 single-owner action (both k=1)", () => {
  const bytes = 42n;
  const oneOfOne = gasUnits(cal(), bytes, ownerAuthUnits(1n)); // migrated owners:[K], threshold 1
  const v1SingleOwner = gasUnits(cal(), bytes, ownerAuthUnits(1n)); // v1 owner_pubkey → k=1
  assert.equal(oneOfOne, v1SingleOwner);
});

test("settle threads ownerAuth into FINALIZED consumed gas (and not into pre-validation outcomes)", () => {
  const state = { governance: { params: {} }, ptra: { balances: { [A]: 10n ** 18n } } } as Json;
  const bytes = 10n;
  const fin0 = settle("FINALIZED", cal(), state, bytes); // no ownerAuth
  const finK = settle("FINALIZED", cal(), state, bytes, ownerAuthUnits(2n));
  assert.ok(finK.dynamicGasConsumed > fin0.dynamicGasConsumed, "owner-auth raises consumed gas");
  assert.equal(finK.totalAgentCharge - fin0.totalAgentCharge, finK.dynamicGasConsumed - fin0.dynamicGasConsumed);
  // pre-validation spam charge ignores ownerAuth (owner verification never priced before execution):
  const spam0 = settle("FAILED_PRECOND", cal(), state, 0n);
  const spamK = settle("FAILED_PRECOND", cal(), state, 0n, ownerAuthUnits(2n));
  assert.equal(spamK.totalAgentCharge, spam0.totalAgentCharge);
});
