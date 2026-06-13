// L2.5 — the AnchorRecord schema: the off-chain-observed fact that a projected state version's STATE_ROOT
// was committed on-chain (the PP#2 / PP#4-B anchor pattern), stored by the Anchor index (as an OPAQUE ref
// — the contract never parses or verifies it; only off-chain code does).
//
// Framing A: a faithful record of an observed anchor, NOT a verification. The reader re-derives the
// STATE_ROOT off-chain and confirms `txHash` on-chain itself; this record blesses nothing.
import { beginCell, Cell, type Slice } from "@ton/core";

export interface AnchorRecord {
  /** the quorum-/fold-finalized consensus STATE_ROOT that was anchored (e.g. PP#4-B 0x4a14…) */
  readonly stateRoot: bigint;
  /** the ton-testnet/mainnet tx that published the anchor */
  readonly txHash: bigint;
  /** the anchoring tx logical time */
  readonly lt: bigint;
  /** unixtime the off-chain observer recorded this fact */
  readonly recordedAt: number;
}

/** Serialize an AnchorRecord to the cell the Anchor index stores verbatim. */
export function anchorRecordToCell(r: AnchorRecord): Cell {
  return beginCell().storeUint(r.stateRoot, 256).storeUint(r.txHash, 256).storeUint(r.lt, 64).storeUint(r.recordedAt, 32).endCell();
}

/** Parse an AnchorRecord cell (off-chain only — the contract treats it as opaque). */
export function cellToAnchorRecord(cell: Cell): AnchorRecord {
  const s: Slice = cell.beginParse();
  const stateRoot = s.loadUintBig(256);
  const txHash = s.loadUintBig(256);
  const lt = s.loadUintBig(64);
  const recordedAt = s.loadUint(32);
  return { stateRoot, txHash, lt, recordedAt };
}
