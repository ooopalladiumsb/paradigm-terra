// L2.1 — the AgentRecord schema: the off-chain projection of `state.registry.agents[agent_id]` that the
// Registry read-model stores (as an OPAQUE ref — the contract never parses it; only off-chain code does).
//
// Framing A: this is a faithful mirror of the frozen consensus record, not a re-derivation. The owners[]
// list is committed as `ownersHash` (and granted_scopes as `scopesHash`) — bounded commitments the reader
// verifies against the full off-chain values. `recordVersion` is the projecting tick/state-root tag.
import { beginCell, Cell, type Slice } from "@ton/core";

export interface AgentRecord {
  /** operator_pubkey — raw Ed25519, as a uint256 (state.registry.agents[a].operator_pubkey) */
  readonly operatorPubkey: bigint;
  /** commitment to the sorted owners[] (multisig owner set) */
  readonly ownersHash: bigint;
  /** M-of-N threshold (1 for single-owner agents) */
  readonly threshold: number;
  /** commitment to the granted_scopes set */
  readonly scopesHash: bigint;
  /** the projecting tick / state-root tag this record was mirrored from */
  readonly recordVersion: number;
}

/** Serialize an AgentRecord to the cell the Registry stores verbatim (288+288+32+ ... fits one cell). */
export function agentRecordToCell(r: AgentRecord): Cell {
  return beginCell()
    .storeUint(r.operatorPubkey, 256)
    .storeUint(r.ownersHash, 256)
    .storeUint(r.threshold, 32)
    .storeUint(r.scopesHash, 256)
    .storeUint(r.recordVersion, 32)
    .endCell();
}

/** Parse an AgentRecord cell (off-chain only — the contract treats it as opaque). */
export function cellToAgentRecord(cell: Cell): AgentRecord {
  const s: Slice = cell.beginParse();
  const operatorPubkey = s.loadUintBig(256);
  const ownersHash = s.loadUintBig(256);
  const threshold = s.loadUint(32);
  const scopesHash = s.loadUintBig(256);
  const recordVersion = s.loadUint(32);
  return { operatorPubkey, ownersHash, threshold, scopesHash, recordVersion };
}
