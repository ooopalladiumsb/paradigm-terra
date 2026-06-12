/**
 * Gas-unit model (CAL Spec §9.2). The DSL portion is delegated to
 * `dsl.expressionCost`, so it is byte-for-byte the same numbers the DSL layer
 * already pins (binary=1, contains_key=10, size=20, path-segment=2, gate=5).
 * MCP and rent costs are layered on top. All units are bigint (uint256).
 */

import { canonicalizeValue } from "@paradigm-terra/canonical";
import { expressionCost, parseEnvelope, type Scope } from "@paradigm-terra/dsl";
import { getIn, type Json } from "./util.js";

export const GAS_UNITS = {
  MCP_READ: 50n, // get_*  MCP call
  MCP_WRITE: 200n, // any other (mutating) MCP call
  INVARIANT_BASE: 5n, // per invariant expression, plus its DSL cost
  STATE_RENT_PER_BYTE: 1n,
  // PFC2-M4 (Multisig v2.1, §9.2): owner-authorization verification weight. Linear in the
  // number of owner signatures actually verified (NOT the owner-set size), so a 2-of-16 agent
  // pays for 2 verifies, not 16. The OPERATOR signature is unpriced (one raw verify, exactly as
  // v1) — multisig prices only the owner-authorization model it introduces.
  OWNER_AUTH_BASE: 50n, // fixed setup for the owner-authorization check (k ≥ 1)
  ED25519_VERIFY_WEIGHT: 100n, // per verified owner signature (one Ed25519 verify)
} as const;

/**
 * PFC2-M4 §9.2: owner-authorization gas, linear in `k` = the number of owner signatures the
 * node actually verified. `0` when the action is not owner-gated (k = 0), so non-owner actions —
 * the operator-only path — keep their exact v1 cost. A v1 single-owner action and its migrated
 * 1-of-1 form both have k = 1, so they price identically (SC-4).
 */
export function ownerAuthUnits(k: bigint): bigint {
  return k <= 0n ? 0n : GAS_UNITS.OWNER_AUTH_BASE + k * GAS_UNITS.ED25519_VERIFY_WEIGHT;
}

/** Cost of one embedded DSL expression (bare AST under v1.2, or an envelope). */
function dslCost(node: Json | undefined, scope: Scope): bigint {
  let version: "1.1" | "1.2" = "1.2";
  let expr: unknown = node;
  if (typeof node === "object" && node !== null && !Array.isArray(node) && "dsl_version" in node) {
    const env = parseEnvelope(node);
    version = env.version;
    expr = env.expr;
  }
  return BigInt(expressionCost(expr, { scope, version }));
}

/** MCP-call units for a step verb: `get_*` is a read (50), everything else a write (200). */
export function mcpCallUnits(verb: string): bigint {
  const part = verb.split(".")[1] ?? "";
  return part.startsWith("get_") ? GAS_UNITS.MCP_READ : GAS_UNITS.MCP_WRITE;
}

/** Byte length of the committed effects' canonical serialization (state rent input). */
export function effectsBytes(effects: Json): bigint {
  return BigInt(canonicalizeValue(effects).length);
}

/**
 * Data-independent gas units of a CAL (everything except state rent):
 * preconditions DSL cost + per-step (1 MCP call + post-condition DSL cost)
 * + per-invariant (base 5 + DSL cost).
 */
export function staticGasUnits(cal: Json): bigint {
  let u = 0n;
  u += dslCost(getIn(cal, ["preconditions"]), "precondition");

  const steps = getIn(cal, ["steps"]);
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const verb = getIn(step, ["verb"]);
      if (typeof verb === "string") u += mcpCallUnits(verb);
      const pcs = getIn(step, ["post_conditions"]);
      if (Array.isArray(pcs)) for (const pc of pcs) u += dslCost(pc, "post_condition");
    }
  }

  const invariants = getIn(cal, ["invariants"]);
  if (Array.isArray(invariants)) {
    for (const inv of invariants) u += GAS_UNITS.INVARIANT_BASE + dslCost(inv, "invariant");
  }
  return u;
}

/**
 * Total gas units = static units + state rent (1 per byte written) + owner-authorization weight.
 * `ownerAuth` (PFC2-M4, from `ownerAuthUnits(k)`) defaults to 0, so every non-owner-gated CAL —
 * and every caller that does not pass it — is byte-for-byte the v1 cost.
 */
export function gasUnits(cal: Json, bytesWritten: bigint, ownerAuth: bigint = 0n): bigint {
  return staticGasUnits(cal) + bytesWritten * GAS_UNITS.STATE_RENT_PER_BYTE + ownerAuth;
}
