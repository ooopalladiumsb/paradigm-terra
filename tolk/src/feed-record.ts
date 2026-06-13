// L3.2 — the FeedRecord schema: the off-chain projection of a settled oracle feed that the oracle view
// stores (as an OPAQUE ref — the contract never parses/aggregates it).
//
// Framing A: a faithful mirror of the off-chain-settled feed value, NOT an aggregation. The reader
// verifies it against the full off-chain oracle state; this record aggregates/decides nothing.
import { beginCell, Cell, type Slice } from "@ton/core";

export interface FeedRecord {
  /** the settled feed value (e.g. TON/USD scaled), decided off-chain */
  readonly value: bigint;
  /** the tick the feed was settled at */
  readonly updatedAtTick: bigint;
  /** the projecting tick / state-root tag */
  readonly version: number;
}

export function feedRecordToCell(r: FeedRecord): Cell {
  return beginCell().storeUint(r.value, 256).storeUint(r.updatedAtTick, 64).storeUint(r.version, 64).endCell();
}

export function cellToFeedRecord(cell: Cell): FeedRecord {
  const s: Slice = cell.beginParse();
  const value = s.loadUintBig(256);
  const updatedAtTick = s.loadUintBig(64);
  const version = s.loadUint(64);
  return { value, updatedAtTick, version };
}
