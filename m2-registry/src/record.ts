// M2-A · SC-1 — the reconciliation-record schema (TS mirror of the on-chain `Record` / `Storage`
// layout in contracts/reconciliation_registry.tolk). This is the typed boundary the off-chain
// reconciler (M2-B / SC-2) will populate; here it exists only as the schema + (de)serialization, with
// a round-trip test proving the TS codec and the Tolk struct agree on the bit layout. No logic.
import { beginCell, Cell, Address } from "@ton/core";

/** Settlement status codes — MUST match the STATUS_* constants in the Tolk contract. */
export enum SettlementStatus {
  /** absent / never recorded — never stored, only returned for a missing key */
  Unknown = 0,
  /** on-chain effect observed == CAL-authorized action */
  Settled = 1,
  /** emitted, but no settling transaction observed within the window */
  Missing = 2,
  /** settling transaction observed late (outside the expected window) */
  Delayed = 3,
  /** a settling transaction was observed but its effect != expected */
  Mismatch = 4,
}

/** The on-chain message op for an owner-only record upsert (matches OP_UPSERT_RECORD in Tolk). */
export const OP_UPSERT_RECORD = 0x52454301;
/** external_message_hash key width (matches KEY_BITS in Tolk). */
export const KEY_BITS = 256;

/** One settlement entry. Field widths mirror the Tolk `Record` struct exactly. */
export type ReconciliationRecord = {
  status: SettlementStatus; // uint8
  nonce: bigint; // uint64  — CAL nonce (== W5 seqno + 1)
  calHash: bigint; // uint256 — originating CAL identity
  txHash: bigint; // uint256 — observed settling tx (0n if none yet)
  observedEffectHash: bigint; // uint256 — observed on-chain effect (0n if none yet)
  updatedAt: number; // uint32  — unixtime of last write
};

/** Serialize a record into a cell with the exact on-chain bit layout. */
export function buildRecordCell(r: ReconciliationRecord): Cell {
  if (r.status < SettlementStatus.Settled || r.status > SettlementStatus.Mismatch) {
    throw new Error(`status out of stored range 1..4: ${r.status}`);
  }
  return beginCell()
    .storeUint(r.status, 8)
    .storeUint(r.nonce, 64)
    .storeUint(r.calHash, 256)
    .storeUint(r.txHash, 256)
    .storeUint(r.observedEffectHash, 256)
    .storeUint(r.updatedAt, 32)
    .endCell();
}

/** Parse a record cell back out (inverse of buildRecordCell). */
export function parseRecordCell(c: Cell): ReconciliationRecord {
  const s = c.beginParse();
  const rec: ReconciliationRecord = {
    status: s.loadUint(8) as SettlementStatus,
    nonce: s.loadUintBig(64),
    calHash: s.loadUintBig(256),
    txHash: s.loadUintBig(256),
    observedEffectHash: s.loadUintBig(256),
    updatedAt: s.loadUint(32),
  };
  s.endParse();
  return rec;
}

/**
 * Build the body of an OP_UPSERT_RECORD message: `op:uint32 | key:uint256 | ^Record` — the 872-bit
 * record rides in a ref (it cannot fit inline alongside op+key in a single 1023-bit cell). Matches the
 * Tolk handler `op; key = loadUint(256); Record.fromCell(loadRef())`.
 */
export function buildUpsertBody(externalMessageHash: bigint, r: ReconciliationRecord): Cell {
  return beginCell()
    .storeUint(OP_UPSERT_RECORD, 32)
    .storeUint(externalMessageHash, KEY_BITS)
    .storeRef(buildRecordCell(r))
    .endCell();
}

/** Initial storage cell for a freshly-deployed registry (empty record dict). */
export function buildInitialStorage(owner: Address): Cell {
  return beginCell().storeAddress(owner).storeUint(0, 32).storeDict(null).endCell();
}
