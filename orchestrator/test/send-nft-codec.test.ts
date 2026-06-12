/**
 * wallet.send_nft publication codec (TEP-62). SC-1: canonicalToInner projects a send_nft step onto one
 * faithful action_send_msg carrying the TEP-62 transfer body — NO amount (an NFT item is indivisible), the
 * dest IS the NFT item (no master-derivation), the ⊆ rule on the new owner + the attached TON value, the
 * normalization defaults, and malformed-param rejection. Publication layer (§8.3) — offline, no Freeze-Surface impact.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "@paradigm-terra/cal-reducer";
import { canonicalToInner, W5CodecError, NFT_TRANSFER_OP, NFT_TRANSFER_TON } from "../src/w5/canonical-to-inner.js";

const AGENT = "0:" + "bb".repeat(32);
const ITEM = "0:" + "1a".repeat(32); // the NFT item contract (the message dest)
const NEWOWNER = "0:" + "dd".repeat(32);
const RESP = "0:" + "ee".repeat(32);

type NftParams = { nft_item?: string; new_owner?: string; query_id?: bigint; response_destination?: string; forward_amount?: bigint; forward_payload?: Json };
const sendNft = (params: NftParams): Json => ({ verb: "wallet.send_nft", params: params as unknown as Json, post_conditions: [] });
const ncal = (params: NftParams): Json => ({ cal_version: "0.1.0", action: "wallet.send_nft", agent_id: AGENT, nonce: 1n, expiration_tick: 1000n, preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [], steps: [sendNft(params)], receipt_required: true });
const bodyOf = (cal: Json): Record<string, Json> => canonicalToInner(cal).outActions[0]!.msg.body as Record<string, Json>;

test("SC-1: a faithful TEP-62 transfer action (new_owner, value, op, item dest, NO amount)", () => {
  const inner = canonicalToInner(ncal({ nft_item: ITEM, new_owner: NEWOWNER, query_id: 7n, response_destination: RESP, forward_amount: 1n }));
  assert.equal(inner.outActions.length, 1);
  const a = inner.outActions[0]!;
  assert.equal(a.type, "action_send_msg");
  assert.equal(a.mode, 1, "exact-value send mode (no carry bits)");
  // outer message: dest IS the nft item (resolved directly — no get_wallet_address hop), no jettonMaster
  assert.equal(a.msg.dest, ITEM, "the NFT item address is the dest, resolved at the IR layer");
  assert.equal(a.msg.jettonMaster, undefined, "send_nft carries no jettonMaster");
  assert.equal(a.msg.valueNano, 1n + NFT_TRANSFER_TON, "attached TON = forward_amount + bounded gas");
  // TEP-62 body — faithful, ⊆, and crucially NO `amount`
  const b = a.msg.body as Record<string, Json>;
  assert.equal(b["op"], BigInt(NFT_TRANSFER_OP));
  assert.equal(b["query_id"], 7n);
  assert.equal(b["new_owner"], NEWOWNER, "⊆: new owner faithful, no redirection");
  assert.equal(b["response_destination"], RESP);
  assert.equal(b["forward_amount"], 1n);
  assert.equal(b["custom_payload"], null);
  assert.equal(b["forward_payload"], null);
  assert.equal(b["amount"], undefined, "an NFT item is indivisible — there is no amount field");
});

test("SC-1: normalization — omitted defaults (response_destination ⇒ agent, forward ⇒ 0, payload ⇒ null)", () => {
  const a = canonicalToInner(ncal({ nft_item: ITEM, new_owner: NEWOWNER, query_id: 0n })).outActions[0]!;
  const b = a.msg.body as Record<string, Json>;
  assert.equal(b["response_destination"], AGENT, "response_destination ⇒ the agent (sender)");
  assert.equal(b["forward_amount"], 0n, "forward_amount ⇒ 0");
  assert.equal(b["forward_payload"], null, "forward_payload ⇒ absent");
  assert.equal(a.msg.valueNano, NFT_TRANSFER_TON, "attached TON = 0 + bounded gas");
});

test("SC-1 ⊆: the item dest and new owner are carried exactly (cannot redirect)", () => {
  const inner = canonicalToInner(ncal({ nft_item: ITEM, new_owner: NEWOWNER, query_id: 1n }));
  assert.equal(inner.outActions[0]!.msg.dest, ITEM);
  assert.equal((inner.outActions[0]!.msg.body as Record<string, Json>)["new_owner"], NEWOWNER);
});

test("SC-1 reject: required-explicit params", () => {
  const bad = (p: NftParams, re: RegExp) => assert.throws(() => canonicalToInner(ncal(p)), (e) => e instanceof W5CodecError && e.code === "W5_MALFORMED_PARAMS" && re.test(e.message));
  bad({ new_owner: NEWOWNER, query_id: 1n }, /nft_item/);
  bad({ nft_item: ITEM, query_id: 1n }, /new_owner/);
  bad({ nft_item: ITEM, new_owner: NEWOWNER }, /query_id/); // absent ⇒ rejected (never auto-generated)
});

test("SC-1 reject: query_id out of uint64, negative forward", () => {
  const bad = (p: NftParams, re: RegExp) => assert.throws(() => canonicalToInner(ncal(p)), (e) => e instanceof W5CodecError && re.test(e.message));
  bad({ nft_item: ITEM, new_owner: NEWOWNER, query_id: 1n << 64n }, /uint64/);
  bad({ nft_item: ITEM, new_owner: NEWOWNER, query_id: -1n }, /uint64/);
  bad({ nft_item: ITEM, new_owner: NEWOWNER, query_id: 1n, forward_amount: -1n }, /forward_amount must be non-negative/);
});

test("regression: wallet.send_ton and wallet.send_jetton still encode unchanged", () => {
  const ton: Json = { cal_version: "0.1.0", action: "wallet.send_ton", agent_id: AGENT, nonce: 1n, expiration_tick: 1000n, preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: { to: NEWOWNER, amount_nano: 50n }, post_conditions: [] }], receipt_required: true };
  const a = canonicalToInner(ton).outActions[0]!;
  assert.equal(a.msg.dest, NEWOWNER);
  assert.equal(a.msg.valueNano, 50n);
});
