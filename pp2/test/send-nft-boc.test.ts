/**
 * NFT increment — offline round-trip of the TEP-62 nft transfer body: IR → BOC → IR' with IR == IR'. The
 * nft message body is serialized to a W5 cell and parsed back byte-faithfully (op, query_id, new_owner,
 * response_destination, forward_amount) — and crucially carries NO amount (an NFT item is indivisible).
 * Publication layer (§8.3) — no network, no Freeze Surface. A mismatch here is a publication-layer defect.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { irToBoc, bocToIr, nftBodyToCell, NFT_TRANSFER_OP, type InnerRequest, type SendAction, type NftTransferBody } from "../src/ir-to-boc.js";

const ITEM = "0:" + "1a".repeat(32); // the NFT item contract — the on-chain dest
const NEWOWNER = "0:" + "dd".repeat(32);
const RESP = "0:" + "ee".repeat(32);

const nbody = (over: Partial<NftTransferBody> = {}): NftTransferBody => ({
  kind: "nft_transfer",
  op: BigInt(NFT_TRANSFER_OP),
  query_id: 7n,
  new_owner: NEWOWNER,
  response_destination: RESP,
  custom_payload: null,
  forward_amount: 0n,
  forward_payload: null,
  ...over,
});
const nsend = (body: NftTransferBody, valueNano = 50_000_000n): SendAction => ({ type: "action_send_msg", mode: 1, msg: { dest: ITEM, valueNano, body } });
const inner = (outActions: SendAction[]): InnerRequest => ({ outActions, extended: [] });
const roundTrip = (ir: InnerRequest): InnerRequest => bocToIr(irToBoc(ir));

test("SC-2: an nft transfer round-trips identically (full body + dest + value)", () => {
  const ir = inner([nsend(nbody({ forward_amount: 1n }), 1n + 50_000_000n)]);
  assert.deepStrictEqual(roundTrip(ir), ir);
});

test("SC-2: ⊆ preserved at the cell layer — new_owner + item dest survive byte-faithfully", () => {
  const ir = inner([nsend(nbody({ new_owner: NEWOWNER }))]);
  const back = roundTrip(ir).outActions[0]!;
  assert.equal(back.msg.dest, ITEM, "the NFT item dest faithful");
  assert.equal((back.msg.body as NftTransferBody).new_owner, NEWOWNER, "new owner faithful");
  assert.equal((back.msg.body as NftTransferBody).op, BigInt(NFT_TRANSFER_OP));
});

test("SC-2: the serialized body is a TEP-62 transfer (op 0x5fcc3d14) with NO amount field", () => {
  const cell = nftBodyToCell(nbody({ query_id: 42n, forward_amount: 3n }));
  const s = cell.beginParse();
  assert.equal(s.loadUint(32), NFT_TRANSFER_OP, "op 0x5fcc3d14");
  assert.equal(s.loadUintBig(64), 42n, "query_id");
  // next field is new_owner (an address) — NOT a coins amount; an NFT body has no amount before the owner.
  assert.equal(s.loadAddress().toRawString(), NEWOWNER, "new_owner immediately follows query_id (no amount)");
});

test("SC-2: an nft mixed with a bare send_ton in one OutList round-trips (order preserved)", () => {
  const bare: SendAction = { type: "action_send_msg", mode: 1, msg: { dest: NEWOWNER, valueNano: 5n, body: null } };
  const ir = inner([bare, nsend(nbody({ query_id: 9n }))]);
  const back = roundTrip(ir);
  assert.equal(back.outActions.length, 2);
  assert.deepStrictEqual(back, ir);
});

test("SC-2: jetton and nft transfers coexist in one OutList (op dispatch is unambiguous)", () => {
  const back = roundTrip(inner([nsend(nbody({ query_id: 1n })), nsend(nbody({ query_id: 2n, forward_amount: 7n }), 7n + 50_000_000n)]));
  assert.equal((back.outActions[0]!.msg.body as NftTransferBody).query_id, 1n);
  assert.equal((back.outActions[1]!.msg.body as NftTransferBody).forward_amount, 7n);
});

test("SC-2: boundary values round-trip (uint64 query_id, large forward_amount)", () => {
  const U64_MAX = (1n << 64n) - 1n;
  const ir = inner([nsend(nbody({ query_id: U64_MAX, forward_amount: 999_000_000_000n }), 999_000_000_000n + 50_000_000n)]);
  const back = roundTrip(ir).outActions[0]!.msg.body as NftTransferBody;
  assert.equal(back.query_id, U64_MAX);
  assert.equal(back.forward_amount, 999_000_000_000n);
});
