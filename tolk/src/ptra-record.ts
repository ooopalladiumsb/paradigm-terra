// L3.3 — the PtraRecord schema: the off-chain projection of a settled PTRA account (balance / staked /
// accrued rewards) that the PTRA view stores (as an OPAQUE ref — the contract never mints/computes it).
//
// Framing A: a faithful mirror of the off-chain-settled PTRA balances, NOT a token. The reader verifies it
// against the full off-chain PTRA state; this record mints/stakes/emits nothing.
import { beginCell, Cell, type Slice } from "@ton/core";

export interface PtraRecord {
  /** liquid PTRA balance (nano-PTRA), settled off-chain */
  readonly balance: bigint;
  /** staked PTRA (nano-PTRA), settled off-chain */
  readonly staked: bigint;
  /** accrued (unclaimed) rewards (nano-PTRA), computed off-chain */
  readonly rewardsAccrued: bigint;
  /** the projecting tick / state-root tag */
  readonly version: number;
}

export function ptraRecordToCell(r: PtraRecord): Cell {
  return beginCell().storeCoins(r.balance).storeCoins(r.staked).storeCoins(r.rewardsAccrued).storeUint(r.version, 64).endCell();
}

export function cellToPtraRecord(cell: Cell): PtraRecord {
  const s: Slice = cell.beginParse();
  const balance = s.loadCoins();
  const staked = s.loadCoins();
  const rewardsAccrued = s.loadCoins();
  const version = s.loadUint(64);
  return { balance, staked, rewardsAccrued, version };
}
