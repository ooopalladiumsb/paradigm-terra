/**
 * Hashing tests: signature omission, key-order independence, distinct domains.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toHex } from "@paradigm-terra/canonical";
import { calHash, canonicalUnsignedBytes, eventHash, receiptHash, transitionEventType } from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const hex = (b: Uint8Array) => `0x${toHex(b)}`;

function cal(extraSig?: string): Record<string, unknown> {
  return {
    cal_version: "0.1.0",
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.x` }, rhs: { const: 0n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {} }],
    receipt_required: true,
    signatures: { operator_sig: extraSig ?? "0x" + "11".repeat(64) },
  };
}

test("CAL_HASH ignores the signatures field entirely (§8.3)", () => {
  const a = cal("0x" + "11".repeat(64));
  const b = cal("0x" + "22".repeat(64));
  // different operator_sig, identical everything else → same CAL_HASH
  assert.equal(hex(calHash(a)), hex(calHash(b)));
});

test("canonical unsigned bytes do not contain the signatures key", () => {
  const bytes = canonicalUnsignedBytes(cal());
  const text = new TextDecoder().decode(bytes);
  assert.ok(!text.includes("signatures"), "unsigned bytes must omit signatures");
  assert.ok(text.includes("operator") === false);
});

test("CAL_HASH is independent of source key order (canonicalization)", () => {
  const c = cal();
  const reordered: Record<string, unknown> = {};
  for (const k of Object.keys(c).reverse()) reordered[k] = c[k];
  assert.equal(hex(calHash(c)), hex(calHash(reordered)));
});

test("EVENT_HASH and RECEIPT_HASH differ for the same event (distinct domains)", () => {
  const ev = { event_type: "cal.finalized", cal_hash: "0x" + "00".repeat(32), nonce: 1n };
  assert.notEqual(hex(eventHash(ev)), hex(receiptHash(ev)));
});

test("transition table maps the happy path and failure/expiry", () => {
  assert.equal(transitionEventType("SIGNED", "VALIDATED"), "cal.validated");
  assert.equal(transitionEventType("SETTLED", "FINALIZED"), "cal.finalized");
  assert.equal(transitionEventType("VALIDATED", "FAILED"), "cal.failed");
  assert.equal(transitionEventType("CREATED", "EXPIRED"), "cal.expired");
  assert.equal(transitionEventType("FINALIZED", "EXPIRED"), null);
  assert.equal(transitionEventType("CREATED", "FINALIZED"), null);
});
