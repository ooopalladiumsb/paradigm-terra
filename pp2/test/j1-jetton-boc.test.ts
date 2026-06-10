/**
 * J1-B — offline round-trip of the TEP-74 jetton transfer body: IR → BOC → IR' with IR == IR'. The
 * jetton message body is serialized to a W5 cell and parsed back byte-faithfully (op, query_id, amount,
 * destination, response_destination, forward_ton_amount). Publication layer (§8.3) — no network, no
 * Freeze Surface. A mismatch here is a publication-layer defect. SC-2.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Cell } from "@ton/core";
import { irToBoc, bocToIr, irToCell, W5BocError, JETTON_TRANSFER_OP, type InnerRequest, type SendAction, type JettonTransferBody } from "../src/ir-to-boc.js";

const JWALLET = "0:" + "a1".repeat(32); // the agent's (resolved) jetton wallet — the on-chain dest
const RECIP = "0:" + "dd".repeat(32);
const RESP = "0:" + "ee".repeat(32);

const jbody = (over: Partial<JettonTransferBody> = {}): JettonTransferBody => ({
  kind: "jetton_transfer",
  op: BigInt(JETTON_TRANSFER_OP),
  query_id: 7n,
  amount: 1000n,
  destination: RECIP,
  response_destination: RESP,
  custom_payload: null,
  forward_ton_amount: 0n,
  forward_payload: null,
  ...over,
});
const jsend = (body: JettonTransferBody, valueNano = 50_000_000n): SendAction => ({ type: "action_send_msg", mode: 1, msg: { dest: JWALLET, valueNano, body } });
const inner = (outActions: SendAction[]): InnerRequest => ({ outActions, extended: [] });
const roundTrip = (ir: InnerRequest): InnerRequest => bocToIr(irToBoc(ir));

test("SC-2: a jetton transfer round-trips identically (full body + dest + value)", () => {
  const ir = inner([jsend(jbody({ forward_ton_amount: 1n }), 1n + 50_000_000n)]);
  assert.deepStrictEqual(roundTrip(ir), ir);
});

test("SC-2: ⊆ preserved at the cell layer — amount + destination survive byte-faithfully", () => {
  const ir = inner([jsend(jbody({ amount: 123_456_789n, destination: RECIP }))]);
  const back = roundTrip(ir).outActions[0]!.msg.body as JettonTransferBody;
  assert.equal(back.amount, 123_456_789n, "jetton amount faithful");
  assert.equal(back.destination, RECIP, "recipient faithful");
  assert.equal(back.op, BigInt(JETTON_TRANSFER_OP));
});

test("SC-2: the serialized body is a TEP-74 transfer (op 0x0f8a7ea5)", () => {
  const cell = irToCell(inner([jsend(jbody())]));
  // navigate: InnerRequest → OutList ref → action → out_msg ref → body; assert the body opcode.
  const boc = cell.toBoc();
  const back = bocToIr(boc).outActions[0]!.msg.body as JettonTransferBody;
  assert.equal(back.op, BigInt(JETTON_TRANSFER_OP));
});

test("SC-2: a jetton mixed with a bare send_ton in one OutList round-trips (order preserved)", () => {
  const bare: SendAction = { type: "action_send_msg", mode: 1, msg: { dest: RECIP, valueNano: 5n, body: null } };
  const ir = inner([bare, jsend(jbody({ query_id: 42n }))]);
  const back = roundTrip(ir);
  assert.equal(back.outActions.length, 2);
  assert.deepStrictEqual(back, ir);
});

test("negative: an unresolved jetton dest ('') is rejected (resolve get_wallet_address first)", () => {
  const ir = inner([{ type: "action_send_msg", mode: 1, msg: { dest: "", valueNano: 50_000_000n, body: jbody() } }]);
  assert.throws(() => irToBoc(ir), (e) => e instanceof W5BocError && e.code === "W5_JETTON_DEST_UNRESOLVED");
});

test("negative: a non-positive jetton amount is rejected at serialization", () => {
  assert.throws(() => irToBoc(inner([jsend(jbody({ amount: 0n }))])), (e) => e instanceof W5BocError && e.code === "W5_JETTON_BAD_AMOUNT");
});
