/**
 * PP#2-A (publication layer, DRAFT, post-freeze — NOT consensus-binding).
 *
 * `ir_to_boc`: serialize the Annex F `InnerRequest` IR (the OutList arm produced by
 * `orchestrator/src/w5/canonical-to-inner.ts`) into a Wallet-V5 signed-body cell + BoC, and parse it
 * back. The point of this layer is an OFFLINE round-trip: IR → BOC → IR' with IR == IR'. A mismatch
 * here is a publication-layer defect found without any network (per `proof-package-2-spec.md` §4,
 * which notes there is no offline *chain-acceptance* oracle — so we validate internal invariants:
 * round-trip identity, structural well-formedness, and the ⊆ authorization rule at the cell layer).
 *
 * W5 InnerRequest layout used here (Wallet V5 spec):
 *   inner_request$_ out_actions:(Maybe ^OutList) has_other_actions:(## 1) ... = InnerRequest
 *   action_send_msg#0ec3c86d mode:(## 8) out_msg:^(MessageRelaxed Any) = OutAction   (via @ton/core)
 * v0.1.0 emits only `out_actions` (the OutList arm); `has_other_actions = 0` (ExtendedActions are the
 * bounded-mode/governance future arm). Cell/BoC primitives + MessageRelaxed come from @ton/core (the
 * reference TON library — we do not reimplement TL-B); the W5 body layout + the IR↔cell mapping are
 * ours and are exactly what the round-trip validates.
 */

import { Address, beginCell, Cell, SendMode, storeOutList, loadOutList, internal } from "@ton/core";

/** Mirrors `orchestrator/src/w5/canonical-to-inner.ts` (the frozen-package IR; re-declared here so
 * the publication layer never imports a frozen package). */
export type IrBody = { readonly comment: string } | null;
export interface OutMessage {
  readonly dest: string; // raw "0:<64hex>"
  readonly valueNano: bigint;
  readonly body: IrBody;
}
export interface SendAction {
  readonly type: "action_send_msg";
  readonly mode: number;
  readonly msg: OutMessage;
}
export interface InnerRequest {
  readonly outActions: readonly SendAction[];
  readonly extended: readonly never[];
}

export const CARRY_REMAINING = 64;
export const CARRY_ALL = 128;

export class W5BocError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "W5BocError";
  }
}

// ── body codec: null = empty cell (bare transfer); {comment} = standard text comment (op 0) ──
function bodyToCell(body: IrBody): Cell {
  if (body === null) return beginCell().endCell();
  return beginCell().storeUint(0, 32).storeStringTail(body.comment).endCell();
}
function cellToBody(cell: Cell): IrBody {
  if (cell.bits.length === 0 && cell.refs.length === 0) return null;
  const s = cell.beginParse();
  if (s.remainingBits >= 32 && s.preloadUint(32) === 0) {
    s.loadUint(32);
    return { comment: s.loadStringTail() };
  }
  throw new W5BocError("W5_UNKNOWN_BODY", "message body is neither empty nor a text comment");
}

/** Build the W5 InnerRequest cell from the IR. Enforces the same ⊆ invariants as the codec
 * (no carry-mode bits, empty extended, ≤255 actions) at the serialization boundary. */
export function irToCell(inner: InnerRequest): Cell {
  if (inner.extended.length !== 0) throw new W5BocError("W5_EXTENDED_NOT_IN_V0_1_0", "extended actions are not serialized in v0.1.0");
  if (inner.outActions.length > 255) throw new W5BocError("W5_TOO_MANY_ACTIONS", `${inner.outActions.length} > 255`);

  const actions: Parameters<typeof storeOutList>[0] = inner.outActions.map((a) => {
    if (a.type !== "action_send_msg") throw new W5BocError("W5_BAD_ACTION", `unsupported action ${String(a.type)}`);
    if ((a.mode & CARRY_REMAINING) !== 0 || (a.mode & CARRY_ALL) !== 0) {
      throw new W5BocError("W5_CARRY_MODE_FORBIDDEN", `mode ${a.mode} carries remaining/all balance — would extend authorization`);
    }
    if (a.msg.valueNano < 0n) throw new W5BocError("W5_NEGATIVE_VALUE", "value must be non-negative");
    return {
      type: "sendMsg",
      mode: a.mode as SendMode,
      outMsg: internal({ to: Address.parseRaw(a.msg.dest), value: a.msg.valueNano, bounce: false, body: bodyToCell(a.msg.body) }),
    };
  });

  const outListCell = beginCell().store(storeOutList(actions)).endCell();
  // out_actions:(Maybe ^OutList) has_other_actions:(## 1 = 0)
  return beginCell().storeMaybeRef(actions.length > 0 ? outListCell : null).storeBit(false).endCell();
}

/** IR → BoC bytes (the publishable inner-body serialization). */
export function irToBoc(inner: InnerRequest): Buffer {
  return irToCell(inner).toBoc();
}
export function irToBocBase64(inner: InnerRequest): string {
  return irToBoc(inner).toString("base64");
}

/** BoC bytes → IR (the inverse). */
export function bocToIr(boc: Buffer): InnerRequest {
  const cell = Cell.fromBoc(boc)[0];
  if (!cell) throw new W5BocError("W5_EMPTY_BOC", "no root cell in BoC");
  return cellToIr(cell);
}

/** Cell → IR. */
export function cellToIr(cell: Cell): InnerRequest {
  const s = cell.beginParse();
  const outListSlice = s.loadMaybeRef();
  const hasOther = s.loadBit();
  if (hasOther) throw new W5BocError("W5_UNEXPECTED_EXTENDED", "has_other_actions set — not produced by v0.1.0");

  const outActions: SendAction[] = [];
  if (outListSlice) {
    const actions = loadOutList(outListSlice.beginParse());
    for (const a of actions) {
      if (a.type !== "sendMsg") throw new W5BocError("W5_BAD_ACTION", `decoded a non-send action ${String(a.type)}`);
      const info = a.outMsg.info;
      if (info.type !== "internal") throw new W5BocError("W5_BAD_MESSAGE", `decoded a ${info.type} message`);
      outActions.push({
        type: "action_send_msg",
        mode: a.mode,
        msg: { dest: info.dest.toRawString(), valueNano: info.value.coins, body: cellToBody(a.outMsg.body) },
      });
    }
  }
  return { outActions, extended: [] };
}
