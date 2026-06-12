/**
 * PFC2-M3 — multisig (AuthorizationSet v2) registry: the v1→v2 migration and the
 * well-formed-owner-record invariant. Implements `pfc2-m1-multisig-semantics.md` §1.1/§4.
 *
 * M1 §1.1 said bounds are "reducer-enforced (agent.register/agent.migrate)". M3 refinement:
 * this reducer has NO per-action registry handler — agent owner records are mutated by generic
 * Deltas committed at cal.finalized (apply.ts/delta.ts). So the bound is enforced where those
 * Deltas land — `ownerRecordWellFormed` is checked by `applyDeltaJson` whenever a Delta writes a
 * registry agent's `owners`/`threshold` (delta.ts). This module is the single source of truth for
 * the invariant and the deterministic upgrade function (no external inputs ⇒ reproducible for the
 * M5 NORMATIVE vectors).
 */

import { getIn, setIn, deleteIn, type Json, type State } from "./state.js";

/** §1.1 upper bound on the owner set. */
export const MAX_OWNERS = 16;

/**
 * §1.1: a well-formed v2 owner record. `owners` is a non-empty, DISTINCT, ascending-sorted
 * (by raw pubkey bytes — here hex strings of equal length, so string order == byte order) list
 * of at most MAX_OWNERS hex pubkeys; `1 ≤ threshold ≤ owners.length`. The validator's quorum gate
 * (`multisigQuorum`) assumes this holds, so it must be enforced before such a record commits.
 */
export function ownerRecordWellFormed(owners: Json | undefined, threshold: Json | undefined): boolean {
  if (!Array.isArray(owners)) return false;
  if (typeof threshold !== "bigint") return false;
  const n = owners.length;
  if (n < 1 || n > MAX_OWNERS) return false;
  if (threshold < 1n || threshold > BigInt(n)) return false;
  for (let i = 0; i < n; i++) {
    const o = owners[i];
    if (typeof o !== "string" || o === "") return false;
    if (i > 0) {
      const prev = owners[i - 1] as string;
      if (o === prev) return false; // distinct
      if (o < prev) return false; // ascending
    }
  }
  return true;
}

/**
 * §4: the deterministic v1→v2 registry upgrade. A pure function of the state alone (no external
 * inputs) so it is reproducible when generating the M5 NORMATIVE vectors. For each agent:
 *   owner_pubkey: "K"  →  owners: ["K"], threshold: 1   (and the v1 key is removed)
 *   owner_pubkey: ""   →  owners: [],    threshold: 0   (a "no owner" record; fails any
 *                                                        OWNER_REQUIRED action exactly as v1)
 * Agents already carrying `owners` are left untouched (idempotent re-run). The 1-of-1 result is
 * behaviour-identical to v1 under the validator gate (SC-4); only the encoding moves.
 */
export function migrateRegistryV1ToV2(state: State): State {
  const agents = getIn(state, ["registry", "agents"]);
  if (typeof agents !== "object" || agents === null || Array.isArray(agents)) return state;
  let s: State = state;
  for (const id of Object.keys(agents).sort()) {
    const rec = (agents as { [k: string]: Json })[id];
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) continue;
    if (Array.isArray(rec["owners"])) continue; // already v2
    if (!("owner_pubkey" in rec)) continue; // nothing to migrate
    const pk = rec["owner_pubkey"];
    const owners: Json[] = typeof pk === "string" && pk !== "" ? [pk] : [];
    const threshold: bigint = owners.length === 1 ? 1n : 0n;
    s = setIn(s, ["registry", "agents", id, "owners"], owners) as State;
    s = setIn(s, ["registry", "agents", id, "threshold"], threshold) as State;
    s = deleteIn(s, ["registry", "agents", id, "owner_pubkey"]) as State;
  }
  return s;
}
