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

/** TEP-74 `transfer` opcode (J1-B jetton body). */
export const JETTON_TRANSFER_OP = 0x0f8a7ea5;

/** J1-B — the TEP-74 `transfer` body the jetton codec emits (mirrors the orchestrator IR's jetton body).
 * `custom_payload`/`forward_payload` are fixed-absent this increment (Non-goals, PFC2-1 §8). */
export interface JettonTransferBody {
  readonly kind: "jetton_transfer";
  readonly op: bigint; // == JETTON_TRANSFER_OP
  readonly query_id: bigint; // uint64
  readonly amount: bigint; // jetton units (VarUInteger 16)
  readonly destination: string; // raw — the jetton receiver (owner)
  readonly response_destination: string; // raw
  readonly custom_payload: null;
  readonly forward_ton_amount: bigint; // nanoTON (VarUInteger 16)
  readonly forward_payload: null;
}

/** Mirrors `orchestrator/src/w5/canonical-to-inner.ts` (the publication-layer IR; re-declared here so
 * pp2 never imports another package's types). A jetton message body carries the TEP-74 transfer. */
export type IrBody = { readonly comment: string } | JettonTransferBody | null;
export interface OutMessage {
  /** raw "0:<64hex>". For a jetton transfer this is the (resolved) agent jetton wallet — the orchestrator
   *  IR leaves it "" with jettonMaster; the resolution step fills it before serialization here. */
  readonly dest: string;
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

const isJetton = (b: IrBody): b is JettonTransferBody => b !== null && "kind" in b && b.kind === "jetton_transfer";

// TEP-74: transfer#0f8a7ea5 query_id:uint64 amount:(VarUInteger 16) destination:MsgAddress
//   response_destination:MsgAddress custom_payload:(Maybe ^Cell)
//   forward_ton_amount:(VarUInteger 16) forward_payload:(Either Cell ^Cell)
export function jettonBodyToCell(b: JettonTransferBody): Cell {
  if (b.amount <= 0n) throw new W5BocError("W5_JETTON_BAD_AMOUNT", "jetton amount must be > 0");
  return beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(b.query_id, 64)
    .storeCoins(b.amount)
    .storeAddress(Address.parseRaw(b.destination))
    .storeAddress(Address.parseRaw(b.response_destination))
    .storeMaybeRef(null) // custom_payload absent
    .storeCoins(b.forward_ton_amount)
    .storeBit(false) // forward_payload: Either-left, inline empty (absent this increment)
    .endCell();
}
function cellToJettonBody(s: ReturnType<Cell["beginParse"]>): JettonTransferBody {
  s.loadUint(32); // op (already matched)
  const query_id = s.loadUintBig(64);
  const amount = s.loadCoins();
  const destination = s.loadAddress().toRawString();
  const response_destination = s.loadAddress().toRawString();
  if (s.loadMaybeRef() !== null) throw new W5BocError("W5_JETTON_CUSTOM_PAYLOAD", "custom_payload is fixed-absent this increment");
  const forward_ton_amount = s.loadCoins();
  if (s.loadBit() !== false) throw new W5BocError("W5_JETTON_FORWARD_PAYLOAD", "forward_payload is fixed-absent this increment");
  return { kind: "jetton_transfer", op: BigInt(JETTON_TRANSFER_OP), query_id, amount, destination, response_destination, custom_payload: null, forward_ton_amount, forward_payload: null };
}

// ── body codec: null = empty cell; {comment} = text comment (op 0); jetton = TEP-74 transfer (op 0f8a7ea5) ──
function bodyToCell(body: IrBody): Cell {
  if (body === null) return beginCell().endCell();
  if (isJetton(body)) return jettonBodyToCell(body);
  return beginCell().storeUint(0, 32).storeStringTail(body.comment).endCell();
}
function cellToBody(cell: Cell): IrBody {
  if (cell.bits.length === 0 && cell.refs.length === 0) return null;
  const s = cell.beginParse();
  if (s.remainingBits >= 32) {
    const op = s.preloadUint(32);
    if (op === 0) {
      s.loadUint(32);
      return { comment: s.loadStringTail() };
    }
    if (op === JETTON_TRANSFER_OP) return cellToJettonBody(s);
  }
  throw new W5BocError("W5_UNKNOWN_BODY", "message body is neither empty, a text comment, nor a TEP-74 transfer");
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
    if (a.msg.dest === "") throw new W5BocError("W5_JETTON_DEST_UNRESOLVED", "dest is unresolved — resolve the agent jetton wallet (get_wallet_address) before serialization");
    // a jetton transfer bounces (so a failed jetton-wallet hop returns the TON); a bare transfer does not.
    const bounce = isJetton(a.msg.body);
    return {
      type: "sendMsg",
      mode: a.mode as SendMode,
      outMsg: internal({ to: Address.parseRaw(a.msg.dest), value: a.msg.valueNano, bounce, body: bodyToCell(a.msg.body) }),
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
