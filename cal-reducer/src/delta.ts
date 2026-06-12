/**
 * The `Delta` effect language (reducer design §4). A Delta is a namespace-scoped,
 * self-describing state mutation carried by an event; the reducer replays it
 * deterministically. Integer ops are checked uint256 — underflow/overflow yield a
 * typed ApplyError, never wrap.
 */

import { ApplyError } from "./errors.js";
import { ownerRecordWellFormed } from "./migrate.js";
import { deleteIn, getIn, setIn, type Json, type State } from "./state.js";

export const UINT256_MAX = 2n ** 256n - 1n;

/**
 * PFC2-M3 §1.1: enforce the well-formed v2 owner-record bound at the point Deltas commit it.
 * A Delta writing `registry/agents/<a>/owners` or `.../threshold` makes the validator's quorum
 * gate assume a sorted/distinct/in-bounds record — guarantee it here. Owner records may set
 * `owners` and `threshold` in separate Deltas, so the check fires only once BOTH are present
 * (a partially-built record is a transient intermediate, validated when the second field lands).
 */
function enforceOwnerRecord(state: State, full: readonly string[]): void {
  if (full.length !== 4 || full[0] !== "registry" || full[1] !== "agents") return;
  if (full[3] !== "owners" && full[3] !== "threshold") return;
  const rec = getIn(state, ["registry", "agents", full[2]!]);
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return;
  if (!("owners" in rec) || !("threshold" in rec)) return; // not yet complete
  if (!ownerRecordWellFormed(rec["owners"], rec["threshold"])) {
    throw new ApplyError("BAD_OWNER_RECORD", `registry.agents.${full[2]}`);
  }
}

export type DeltaOp = "set" | "add" | "sub" | "delete";

function asBigint(v: Json | undefined): bigint {
  if (typeof v !== "bigint") throw new ApplyError("BAD_DELTA", "expected integer operand");
  return v;
}

/** Validate + apply one Delta (given as a JSON value, e.g. from staged effects). */
export function applyDeltaJson(state: State, d: Json): State {
  if (typeof d !== "object" || d === null || Array.isArray(d)) throw new ApplyError("BAD_DELTA", "delta must be an object");
  const ns = d["ns"];
  const op = d["op"];
  const path = d["path"];
  if (typeof ns !== "string") throw new ApplyError("BAD_DELTA", "ns must be a string");
  if (typeof op !== "string") throw new ApplyError("BAD_DELTA", "op must be a string");
  if (!Array.isArray(path) || !path.every((p) => typeof p === "string")) {
    throw new ApplyError("BAD_DELTA", "path must be a string array");
  }
  const full = [ns, ...(path as string[])];

  switch (op as DeltaOp) {
    case "set": {
      const next = setIn(state, full, d["value"] ?? null) as State;
      enforceOwnerRecord(next, full);
      return next;
    }
    case "delete":
      return deleteIn(state, full) as State;
    case "add": {
      const cur = asBigint(getIn(state, full) ?? 0n);
      const res = cur + asBigint(d["value"]);
      if (res > UINT256_MAX) throw new ApplyError("OVERFLOW", `${full.join(".")}`);
      return setIn(state, full, res) as State;
    }
    case "sub": {
      const cur = asBigint(getIn(state, full) ?? 0n);
      const res = cur - asBigint(d["value"]);
      if (res < 0n) throw new ApplyError("UNDERFLOW", `${full.join(".")}`);
      return setIn(state, full, res) as State;
    }
    default:
      throw new ApplyError("BAD_DELTA", `unknown op ${JSON.stringify(op)}`);
  }
}
