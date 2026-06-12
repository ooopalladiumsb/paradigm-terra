/**
 * Annex F (DRAFT) — canonicalToInner invariant tests. Offline checks on the CAL→W5 OutList
 * projection (the model-bearing transform; BoC serialization is the network-gated follow-on).
 * Pins the publication-layer rule TON-valid ⊆ CAL-valid (review §7) at the action level.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "@paradigm-terra/cal-reducer";
import { canonicalToInner, classifyVerb, W5CodecError, CARRY_REMAINING, CARRY_ALL } from "../src/w5/canonical-to-inner.js";

const DEST = "0:" + "cc".repeat(32);
const sendTon = (to: string, amountNano: bigint, body?: Json) => ({ verb: "wallet.send_ton", params: body === undefined ? { to, amount_nano: amountNano } : { to, amount_nano: amountNano, body }, post_conditions: [] });
const cal = (steps: Json[]): Json => ({ cal_version: "0.1.0", action: "wallet.send_ton", agent_id: "0:" + "bb".repeat(32), nonce: 1n, expiration_tick: 1000n, preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [], steps, receipt_required: true });

test("wallet.send_ton → exactly one faithful action_send_msg (dest, value, exact mode)", () => {
  const inner = canonicalToInner(cal([sendTon(DEST, 5_000n)]));
  assert.equal(inner.outActions.length, 1);
  assert.equal(inner.extended.length, 0);
  const a = inner.outActions[0]!;
  assert.equal(a.type, "action_send_msg");
  assert.equal(a.msg.dest, DEST);
  assert.equal(a.msg.valueNano, 5_000n);
  // exact-value mode: never the carry-remaining / carry-all bits (would extend authorization)
  assert.equal(a.mode & CARRY_REMAINING, 0);
  assert.equal(a.mode & CARRY_ALL, 0);
});

test("no fan-out: N send steps → exactly N actions", () => {
  const steps = [sendTon(DEST, 1n), sendTon(DEST, 2n), sendTon(DEST, 3n)];
  const inner = canonicalToInner(cal(steps));
  assert.equal(inner.outActions.length, 3);
});

test("authorization width: value & dest faithful, no inflation, no redirection", () => {
  const inner = canonicalToInner(cal([sendTon(DEST, 100n), sendTon(DEST, 250n)]));
  const totalOut = inner.outActions.reduce((s, a) => s + a.msg.valueNano, 0n);
  assert.equal(totalOut, 350n); // == the sum the CAL specified; codec never sends more
  for (const a of inner.outActions) {
    assert.equal(a.msg.dest, DEST); // never a dest the CAL didn't name
    assert.equal(a.mode & (CARRY_REMAINING | CARRY_ALL), 0);
  }
});

test("unknown verb → explicit rejection (no silent drop)", () => {
  assert.throws(() => canonicalToInner(cal([{ verb: "evil.pwn", params: {}, post_conditions: [] }])), (e) => e instanceof W5CodecError && e.code === "W5_UNKNOWN_VERB");
});

test("failure_mode.* (config) stays out of v0.1.0 → rejected as ExtendedActions", () => {
  assert.throws(() => canonicalToInner(cal([{ verb: "failure_mode.enter_bounded", params: {}, post_conditions: [] }])), (e) => e instanceof W5CodecError && e.code === "W5_EXTENDED_NOT_IN_V0_1_0");
});

test("recognized message verb without a body encoder → rejected, not mis-encoded", () => {
  // wallet.send_ton/send_jetton/send_nft now have encoders; treasury.transfer is still recognized-but-unimplemented.
  assert.throws(() => canonicalToInner(cal([{ verb: "treasury.transfer", params: { to: DEST, amount_nano: 1n }, post_conditions: [] }])), (e) => e instanceof W5CodecError && e.code === "W5_UNIMPLEMENTED_VERB");
});

test("read / cancel steps are codec no-ops (not serialized to on-chain actions)", () => {
  // a mixed CAL: a read, a send, a cancel → only the send projects
  const inner = canonicalToInner(cal([
    { verb: "wallet.get_balance", params: {}, post_conditions: [] },
    sendTon(DEST, 7n),
    { verb: "cal.cancel", params: {}, post_conditions: [] },
  ]));
  assert.equal(inner.outActions.length, 1);
  assert.equal(inner.outActions[0]!.msg.valueNano, 7n);
});

test("no publishable steps → empty OutList (valid, nothing to broadcast)", () => {
  const inner = canonicalToInner(cal([{ verb: "wallet.get_balance", params: {}, post_conditions: [] }]));
  assert.equal(inner.outActions.length, 0);
  assert.equal(inner.extended.length, 0);
});

test("malformed send_ton params → explicit rejection", () => {
  assert.throws(() => canonicalToInner(cal([{ verb: "wallet.send_ton", params: { amount_nano: 1n }, post_conditions: [] }])), (e) => e instanceof W5CodecError && e.code === "W5_MALFORMED_PARAMS");
  assert.throws(() => canonicalToInner(cal([{ verb: "wallet.send_ton", params: { to: DEST }, post_conditions: [] }])), (e) => e instanceof W5CodecError && e.code === "W5_MALFORMED_PARAMS");
});

test("classifyVerb table: send / config / offchain / unknown", () => {
  assert.equal(classifyVerb("wallet.send_ton"), "send");
  assert.equal(classifyVerb("treasury.transfer"), "send");
  assert.equal(classifyVerb("failure_mode.enter_bounded"), "config");
  assert.equal(classifyVerb("failure_mode.emergency_withdraw"), "send");
  assert.equal(classifyVerb("wallet.get_balance"), "offchain");
  assert.equal(classifyVerb("cal.cancel"), "offchain");
  assert.equal(classifyVerb("evil.pwn"), "unknown");
});
