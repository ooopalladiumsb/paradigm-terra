// L3.1 — the ProposalRecord schema: the off-chain projection of a governance proposal's DECIDED tally +
// status that the governance view stores (as an OPAQUE ref — the contract never parses/recomputes it).
//
// Framing A: a faithful mirror of the off-chain-decided governance outcome, NOT a vote. The reader
// verifies it against the full off-chain governance state; this record decides nothing.
import { beginCell, Cell, type Slice } from "@ton/core";

// status of the projected proposal (mirrors the off-chain governance lifecycle). The contract stores the
// raw value verbatim and never interprets it — naming is documentation only.
export const PROPOSAL_OPEN = 0;
export const PROPOSAL_PASSED = 1;
export const PROPOSAL_REJECTED = 2;
export const PROPOSAL_EXECUTED = 3;

export interface ProposalRecord {
  /** votes for (off-chain-tallied; e.g. quadratic power) */
  readonly tallyFor: bigint;
  /** votes against (off-chain-tallied) */
  readonly tallyAgainst: bigint;
  /** decided status (PROPOSAL_*) — decided OFF-chain */
  readonly status: number;
  /** amendment tier (Constitution §VII) */
  readonly tier: number;
  /** the projecting tick / state-root tag */
  readonly version: number;
}

export function proposalRecordToCell(r: ProposalRecord): Cell {
  return beginCell()
    .storeUint(r.tallyFor, 256)
    .storeUint(r.tallyAgainst, 256)
    .storeUint(r.status, 8)
    .storeUint(r.tier, 8)
    .storeUint(r.version, 64)
    .endCell();
}

export function cellToProposalRecord(cell: Cell): ProposalRecord {
  const s: Slice = cell.beginParse();
  const tallyFor = s.loadUintBig(256);
  const tallyAgainst = s.loadUintBig(256);
  const status = s.loadUint(8);
  const tier = s.loadUint(8);
  const version = s.loadUint(64);
  return { tallyFor, tallyAgainst, status, tier, version };
}
