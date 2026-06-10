/**
 * J1-A — wallet.send_jetton publication codec (TEP-74). SC-1: canonicalToInner projects a send_jetton
 * step onto one faithful action_send_msg carrying the TEP-74 transfer body, with the ⊆ rule on BOTH the
 * jetton amount and the attached TON value, the D4 normalization defaults, and malformed-param rejection.
 * Publication layer (§8.3) — offline, no Freeze-Surface impact.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "@paradigm-terra/cal-reducer";
import { canonicalToInner, W5CodecError, JETTON_TRANSFER_OP, JETTON_TRANSFER_TON } from "../src/w5/canonical-to-inner.js";

const AGENT = "0:" + "bb".repeat(32);
const MASTER = "0:" + "ab".repeat(32);
const RECIP = "0:" + "dd".repeat(32);
const RESP = "0:" + "ee".repeat(32);

type JettonParams = { jetton_master?: string; recipient?: string; amount?: bigint; query_id?: bigint; response_destination?: string; forward_ton_amount?: bigint; forward_payload?: Json };
const sendJetton = (params: JettonParams): Json => ({ verb: "wallet.send_jetton", params: params as unknown as Json, post_conditions: [] });
const jcal = (params: JettonParams): Json => ({ cal_version: "0.1.0", action: "wallet.send_jetton", agent_id: AGENT, nonce: 1n, expiration_tick: 1000n, preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [], steps: [sendJetton(params)], receipt_required: true });
const bodyOf = (cal: Json): Record<string, Json> => canonicalToInner(cal).outActions[0]!.msg.body as Record<string, Json>;

test("SC-1: a faithful TEP-74 transfer action (amount, recipient, value, op, jetton-wallet dest)", () => {
  const inner = canonicalToInner(jcal({ jetton_master: MASTER, recipient: RECIP, amount: 1000n, query_id: 7n, response_destination: RESP, forward_ton_amount: 1n }));
  assert.equal(inner.outActions.length, 1);
  const a = inner.outActions[0]!;
  assert.equal(a.type, "action_send_msg");
  assert.equal(a.mode, 1, "exact-value send mode (no carry bits)");
  // outer message: dest unresolved (network leg), jettonMaster carried, attached TON = forward + bounded gas
  assert.equal(a.msg.dest, "", "agent jetton wallet is resolved at the network leg (J1-B/PP#3)");
  assert.equal(a.msg.jettonMaster, MASTER);
  assert.equal(a.msg.valueNano, 1n + JETTON_TRANSFER_TON, "attached TON = forward_ton_amount + bounded gas");
  // TEP-74 body — faithful, ⊆
  const b = a.msg.body as Record<string, Json>;
  assert.equal(b["op"], BigInt(JETTON_TRANSFER_OP));
  assert.equal(b["query_id"], 7n);
  assert.equal(b["amount"], 1000n, "⊆: jetton amount faithful, no widening");
  assert.equal(b["destination"], RECIP, "⊆: recipient faithful, no redirection");
  assert.equal(b["response_destination"], RESP);
  assert.equal(b["forward_ton_amount"], 1n);
  assert.equal(b["custom_payload"], null);
  assert.equal(b["forward_payload"], null);
});

test("SC-1: D4 normalization — omitted defaults (response_destination ⇒ agent, forward ⇒ 0, payload ⇒ null)", () => {
  const inner = canonicalToInner(jcal({ jetton_master: MASTER, recipient: RECIP, amount: 5n, query_id: 0n }));
  const a = inner.outActions[0]!;
  const b = a.msg.body as Record<string, Json>;
  assert.equal(b["response_destination"], AGENT, "response_destination ⇒ the agent (sender)");
  assert.equal(b["forward_ton_amount"], 0n, "forward_ton_amount ⇒ 0");
  assert.equal(b["forward_payload"], null, "forward_payload ⇒ absent");
  assert.equal(a.msg.valueNano, JETTON_TRANSFER_TON, "attached TON = 0 + bounded gas");
});

test("SC-1 ⊆: amount and recipient are carried exactly (cannot inflate or redirect)", () => {
  const b = bodyOf(jcal({ jetton_master: MASTER, recipient: RECIP, amount: 123_456_789n, query_id: 1n }));
  assert.equal(b["amount"], 123_456_789n);
  assert.equal(b["destination"], RECIP);
});

test("SC-1 reject: required-explicit params", () => {
  const bad = (p: JettonParams, re: RegExp) => assert.throws(() => canonicalToInner(jcal(p)), (e) => e instanceof W5CodecError && e.code === "W5_MALFORMED_PARAMS" && re.test(e.message));
  bad({ recipient: RECIP, amount: 1n, query_id: 1n }, /jetton_master/);
  bad({ jetton_master: MASTER, amount: 1n, query_id: 1n }, /recipient/);
  bad({ jetton_master: MASTER, recipient: RECIP, query_id: 1n }, /amount/);
  bad({ jetton_master: MASTER, recipient: RECIP, amount: 1n }, /query_id/); // absent ⇒ rejected (never auto-generated)
});

test("SC-1 reject: amount ≤ 0, query_id out of uint64, negative forward", () => {
  const bad = (p: JettonParams, re: RegExp) => assert.throws(() => canonicalToInner(jcal(p)), (e) => e instanceof W5CodecError && re.test(e.message));
  bad({ jetton_master: MASTER, recipient: RECIP, amount: 0n, query_id: 1n }, /amount must be > 0/);
  bad({ jetton_master: MASTER, recipient: RECIP, amount: -5n, query_id: 1n }, /amount must be > 0/);
  bad({ jetton_master: MASTER, recipient: RECIP, amount: 1n, query_id: 1n << 64n }, /uint64/);
  bad({ jetton_master: MASTER, recipient: RECIP, amount: 1n, query_id: -1n }, /uint64/);
  bad({ jetton_master: MASTER, recipient: RECIP, amount: 1n, query_id: 1n, forward_ton_amount: -1n }, /forward_ton_amount must be non-negative/);
});

test("regression: wallet.send_ton still encodes unchanged", () => {
  const cal: Json = { cal_version: "0.1.0", action: "wallet.send_ton", agent_id: AGENT, nonce: 1n, expiration_tick: 1000n, preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: { to: RECIP, amount_nano: 50n }, post_conditions: [] }], receipt_required: true };
  const a = canonicalToInner(cal).outActions[0]!;
  assert.equal(a.msg.dest, RECIP);
  assert.equal(a.msg.valueNano, 50n);
  assert.equal(a.msg.jettonMaster, undefined, "send_ton carries no jettonMaster");
});
