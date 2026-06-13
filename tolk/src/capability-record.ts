// L2.4 — the CapabilityRecord schema: the off-chain projection of an agent's capability state
// (`state.registry.agents[a].granted_scopes` + the capability profile) that the Capability view stores
// (as an OPAQUE ref — the contract never parses it; only off-chain code does).
//
// Framing A: a faithful mirror of decided grants, NOT an authorization. `scopesHash` commits to the
// sorted granted_scopes set; `profileHash` commits to the capability profile (max_transfer_per_tick,
// max_daily_loss, allowed_mcp_methods, …); the reader verifies both against the full off-chain values and
// makes any access decision itself — this record grants nothing.
import { beginCell, Cell, type Slice } from "@ton/core";

export interface CapabilityRecord {
  /** commitment to the sorted granted_scopes set (§4.3 vocabulary) */
  readonly scopesHash: bigint;
  /** commitment to the capability profile (limits / allowed_mcp_methods / confidential flag) */
  readonly profileHash: bigint;
  /** the projecting tick / state-root tag this record was mirrored from */
  readonly version: number;
}

/** Serialize a CapabilityRecord to the cell the Capability view stores verbatim. */
export function capabilityRecordToCell(r: CapabilityRecord): Cell {
  return beginCell().storeUint(r.scopesHash, 256).storeUint(r.profileHash, 256).storeUint(r.version, 32).endCell();
}

/** Parse a CapabilityRecord cell (off-chain only — the contract treats it as opaque). */
export function cellToCapabilityRecord(cell: Cell): CapabilityRecord {
  const s: Slice = cell.beginParse();
  const scopesHash = s.loadUintBig(256);
  const profileHash = s.loadUintBig(256);
  const version = s.loadUint(32);
  return { scopesHash, profileHash, version };
}
