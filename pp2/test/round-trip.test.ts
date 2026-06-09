/**
 * PP#2-A — offline round-trip validation of the publication layer: IR → BOC → IR' with IR == IR'.
 * No network. A mismatch is a publication-layer defect (NOT a Freeze Surface defect — the frozen
 * core is unchanged; this is the post-freeze W5 serialization). See proof-package-2-spec.md §4.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Cell } from "@ton/core";
import { irToBoc, irToBocBase64, bocToIr, W5BocError, CARRY_REMAINING, CARRY_ALL, type InnerRequest, type SendAction, type IrBody } from "../src/ir-to-boc.js";

const DEST = "0:" + "cc".repeat(32);
const DEST2 = "0:" + "ab".repeat(32);
const send = (dest: string, valueNano: bigint, body: IrBody = null): SendAction => ({ type: "action_send_msg", mode: 1, msg: { dest, valueNano, body } });
const inner = (outActions: SendAction[]): InnerRequest => ({ outActions, extended: [] });

const roundTrip = (ir: InnerRequest): InnerRequest => bocToIr(irToBoc(ir));

test("single send_ton (bare transfer, null body) round-trips identically", () => {
  const ir = inner([send(DEST, 5000n)]);
  assert.deepStrictEqual(roundTrip(ir), ir);
});

test("multi-action OutList round-trips (count + order + values preserved)", () => {
  const ir = inner([send(DEST, 100n), send(DEST2, 250n), send(DEST, 1n)]);
  const back = roundTrip(ir);
  assert.equal(back.outActions.length, 3);
  assert.deepStrictEqual(back, ir);
});

test("text-comment body round-trips", () => {
  const ir = inner([send(DEST, 7n, { comment: "paradigm-terra PP#2" })]);
  assert.deepStrictEqual(roundTrip(ir), ir);
});

test("empty OutList → valid InnerRequest, round-trips to empty", () => {
  const ir = inner([]);
  const back = roundTrip(ir);
  assert.equal(back.outActions.length, 0);
  assert.deepStrictEqual(back, ir);
});

test("output is a structurally valid BoC (te6 magic, parseable single root)", () => {
  const boc = irToBoc(inner([send(DEST, 5000n)]));
  assert.ok(boc.length > 0);
  assert.ok(irToBocBase64(inner([send(DEST, 5000n)])).startsWith("te6")); // BoC base64 magic
  assert.equal(Cell.fromBoc(boc).length, 1); // exactly one root cell
});

test("⊆ at the cell layer: decoded value & dest are faithful (no inflation / redirection)", () => {
  const ir = inner([send(DEST, 100n), send(DEST2, 250n)]);
  const back = roundTrip(ir);
  const total = back.outActions.reduce((s, a) => s + a.msg.valueNano, 0n);
  assert.equal(total, 350n); // exactly what the IR specified
  assert.deepStrictEqual(back.outActions.map((a) => a.msg.dest), [DEST, DEST2]);
  for (const a of back.outActions) assert.equal(a.mode & (CARRY_REMAINING | CARRY_ALL), 0);
});

test("carry-remaining / carry-all modes are rejected (would extend authorization)", () => {
  assert.throws(() => irToBoc(inner([{ type: "action_send_msg", mode: CARRY_ALL, msg: { dest: DEST, valueNano: 1n, body: null } }])), (e) => e instanceof W5BocError && e.code === "W5_CARRY_MODE_FORBIDDEN");
  assert.throws(() => irToBoc(inner([{ type: "action_send_msg", mode: 1 | CARRY_REMAINING, msg: { dest: DEST, valueNano: 1n, body: null } }])), (e) => e instanceof W5BocError && e.code === "W5_CARRY_MODE_FORBIDDEN");
});

test("ExtendedActions arm is not serialized in v0.1.0", () => {
  const bad = { outActions: [send(DEST, 1n)], extended: [1 as never] } as unknown as InnerRequest;
  assert.throws(() => irToBoc(bad), (e) => e instanceof W5BocError && e.code === "W5_EXTENDED_NOT_IN_V0_1_0");
});

test(">255 actions exceed the W5 OutList limit", () => {
  const many = inner(Array.from({ length: 256 }, () => send(DEST, 1n)));
  assert.throws(() => irToBoc(many), (e) => e instanceof W5BocError && e.code === "W5_TOO_MANY_ACTIONS");
});

test("negative value rejected", () => {
  assert.throws(() => irToBoc(inner([send(DEST, -1n)])), (e) => e instanceof W5BocError && e.code === "W5_NEGATIVE_VALUE");
});
