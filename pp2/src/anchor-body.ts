/**
 * PP#4-B anchor transport (Multisig STATE_ROOT anchor) — the pinned on-chain body encoding.
 *
 * PP#4-B anchors the quorum-finalized consensus STATE_ROOT on ton-testnet. This module pins box 3 of
 * `docs/notes/pp4-b-gate.md` §2 — "how the 32-byte STATE_ROOT is carried on-chain" — as a typed,
 * byte-reproducible anchor cell, INDEPENDENT of the operator wallet (the outer W5 wrapping + the operator
 * signature are applied at broadcast time with the funded/custodied key; the body below is fixed offline).
 *
 * Transport (pinned):
 *   anchor body cell = op:uint32 (= ANCHOR_OP "PTA1") || state_root:bits256 (raw 32 bytes)
 *
 * The 32-bit op tag is the ASCII bytes "PTA1" (Paradigm Terra Anchor v1) — self-describing and disjoint
 * from op 0 (the text-comment convention) and the TEP-74 transfer op. The root is stored as raw bytes so
 * leading-zero bytes survive; 32 + 256 = 288 bits fit in one cell. The on-chain effect is a self-transfer
 * (operator → operator, bounce=false) whose message body == this cell.
 *
 * Verification (runbook §3 step 5) reconstructs this cell from the offline-proven root and asserts the
 * observed on-chain body is byte-identical — stronger than a string compare.
 *
 * Cell/BoC primitives come from @ton/core (a reference TON library); we do not reimplement TL-B.
 */
import { beginCell, Cell } from "@ton/core";

/** Op tag = ASCII "PTA1" (0x50 0x54 0x41 0x31) — Paradigm Terra Anchor v1. */
export const ANCHOR_OP = 0x50544131;

export class AnchorBodyError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg);
    this.name = "AnchorBodyError";
  }
}

/** Parse a "0x"-prefixed 64-hex (32-byte) root into its raw bytes, rejecting any malformed input. */
function rootToBuffer(rootHex: string): Buffer {
  if (typeof rootHex !== "string" || !/^0x[0-9a-f]{64}$/.test(rootHex)) {
    throw new AnchorBodyError("ANCHOR_BAD_ROOT", `state_root must match /^0x[0-9a-f]{64}$/, got ${JSON.stringify(rootHex)}`);
  }
  return Buffer.from(rootHex.slice(2), "hex");
}

/** Build the pinned anchor body cell carrying `rootHex` (the quorum-finalized STATE_ROOT). */
export function anchorBodyCell(rootHex: string): Cell {
  return beginCell().storeUint(ANCHOR_OP, 32).storeBuffer(rootToBuffer(rootHex)).endCell();
}

/** Parse an anchor body cell back to its "0x…"-prefixed root, asserting the op tag. */
export function parseAnchorRoot(cell: Cell): string {
  const s = cell.beginParse();
  const op = s.loadUint(32);
  if (op !== ANCHOR_OP) {
    throw new AnchorBodyError("ANCHOR_BAD_OP", `op ${op.toString(16)} != ANCHOR_OP ${ANCHOR_OP.toString(16)}`);
  }
  const root = s.loadBuffer(32);
  return `0x${root.toString("hex")}`;
}

/** The pinned anchor body as a base64 BoC — the exact bytes to embed in the broadcast message body. */
export function anchorBodyBoc(rootHex: string): string {
  return anchorBodyCell(rootHex).toBoc().toString("base64");
}
