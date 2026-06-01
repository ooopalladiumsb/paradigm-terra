/**
 * Structural validation tests (CAL Spec §2.1).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCal, validateCal } from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const SIG = "0x" + "ab".repeat(64);

function base(): Record<string, unknown> {
  return {
    cal_version: "0.1.0",
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 0n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: { to: A, amount_nano_ton: 1n } }],
    receipt_required: true,
    signatures: { operator_sig: SIG },
  };
}

test("a well-formed CAL validates", () => {
  assert.equal(checkCal(base()).valid, true);
});

test("compatibility_pragma v0.9.5 is accepted; other values rejected", () => {
  const ok = base();
  ok.compatibility_pragma = "v0.9.5";
  assert.equal(checkCal(ok).valid, true);
  const bad = base();
  bad.compatibility_pragma = "v9.9.9";
  assert.equal(checkCal(bad).code, "BAD_PRAGMA");
});

test("optional gas_limit_ptra accepted as uint256", () => {
  const c = base();
  c.gas_limit_ptra = 10000000n;
  assert.equal(checkCal(c).valid, true);
});

test("owner-required action with owner_sig present validates (no auth check here)", () => {
  const c = base();
  c.action = "treasury.transfer";
  (c.steps as Record<string, unknown>[])[0]!.verb = "treasury.transfer";
  (c.signatures as Record<string, unknown>).owner_sig = SIG;
  assert.equal(checkCal(c).valid, true);
});

// §8.4 Tier-2 (D-S1/D-S2/D-S3): owner_sig accepts the legacy hex string AND the new
// Contract A reconstruction envelope object during the compatibility window.
const OWNER_ENVELOPE = {
  signature: "0x" + "22".repeat(64),
  domain: "ooopalladiumsb.github.io",
  timestamp: 1780211353n,
  workchain: 0n,
  address_hash: "0x" + "ab".repeat(32),
};

test("owner_sig as the Contract A envelope object validates (D-S1)", () => {
  const c = base();
  (c.signatures as Record<string, unknown>).owner_sig = { ...OWNER_ENVELOPE };
  assert.equal(checkCal(c).valid, true);
});

test("owner_sig legacy hex string still validates (dual-accept, D-S3)", () => {
  const c = base();
  (c.signatures as Record<string, unknown>).owner_sig = SIG;
  assert.equal(checkCal(c).valid, true);
});

test("owner envelope rejects empty domain / short address_hash / missing + extra fields", () => {
  const bad = (patch: Record<string, unknown>) => {
    const c = base();
    (c.signatures as Record<string, unknown>).owner_sig = { ...OWNER_ENVELOPE, ...patch };
    return checkCal(c).valid;
  };
  assert.equal(bad({ domain: "" }), false, "empty domain");
  assert.equal(bad({ address_hash: "0xabcd" }), false, "short address_hash (not 32 bytes)");
  assert.equal(bad({ workchain: "0" as unknown as bigint }), false, "non-int workchain");
  assert.equal(bad({ extra: 1n }), false, "unexpected envelope field");
  // missing field
  const c = base();
  const { signature: _omit, ...missing } = OWNER_ENVELOPE;
  (c.signatures as Record<string, unknown>).owner_sig = missing;
  assert.equal(checkCal(c).valid, false, "missing signature");
});

test("invariants must be a list", () => {
  const c = base();
  c.invariants = { not: "a list" };
  assert.equal(checkCal(c).code, "INVARIANTS_NOT_LIST");
});

test("step post_conditions are scope-validated", () => {
  const c = base();
  (c.steps as Record<string, unknown>[])[0]!.post_conditions = [{ op: "eq", lhs: { var: "capability.x" }, rhs: { const: true } }];
  const r = checkCal(c);
  assert.equal(r.code, "DSL_INVALID");
  assert.match(r.detail!, /post_conditions\[0\]: PARSE_ERROR\/GATE_VAR_OUT_OF_SCOPE/);
});

test("invariant may use bracketed state (scope allows it)", () => {
  const c = base();
  c.invariants = [{ op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } }];
  assert.equal(checkCal(c).valid, true);
});

test("validateCal throws CalError on bad input", () => {
  assert.throws(() => validateCal({ not: "a cal" }), /MISSING_FIELD|UNEXPECTED_FIELD/);
});
