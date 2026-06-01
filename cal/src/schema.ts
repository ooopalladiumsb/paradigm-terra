/**
 * CAL wire-format structural validation (CAL Spec §2.1).
 *
 * Validates ONLY what is decidable from the blob alone: field presence/types,
 * registered action/verb taxonomy, canonical address, uint ranges, and that
 * every embedded DSL expression *parses* at its correct scope. It never
 * evaluates DSL (needs state), never verifies signatures (crypto), and never
 * checks nonce monotonicity / expiration / capability (validator/runtime). Those
 * are deferred phases.
 *
 * Embedded expressions are bare ASTs evaluated under DSL v1.2 (CAL v0.1.0 pins
 * DSL v1.2); a `{dsl_version, expr}` envelope is also accepted.
 */

import { isCanonicalAddress, parseCanonical } from "@paradigm-terra/canonical";
import { DslError, isRegisteredAction, parseEnvelope, parseExpression, type Scope } from "@paradigm-terra/dsl";
import { calError } from "./errors.js";

export const CAL_VERSION = "0.1.0";
const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;
const HEX_BYTES = /^0x([0-9a-fA-F]{2})*$/;

const TOP_LEVEL_KEYS = new Set([
  "cal_version",
  "action",
  "agent_id",
  "nonce",
  "expiration_tick",
  "preconditions",
  "invariants",
  "steps",
  "receipt_required",
  "signatures",
  "compatibility_pragma",
  "gas_limit_ptra", // optional; value is gas-phase, structurally allowed here
]);
const STEP_KEYS = new Set(["verb", "params", "post_conditions"]);
const SIG_KEYS = new Set(["operator_sig", "owner_sig", "sponsor_sig"]);

function asObject(v: unknown, code: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw calError(code);
  return v as Record<string, unknown>;
}

function requireUint(v: unknown, max: bigint, code: string): bigint {
  if (typeof v !== "bigint" || v < 0n || v > max) throw calError(code);
  return v;
}

function checkUnexpected(obj: Record<string, unknown>, allowed: Set<string>, code: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw calError(code, k);
  }
}

/** Validate one embedded DSL expression (bare or enveloped) at `scope`. */
function validateEmbeddedDsl(node: unknown, scope: Scope, where: string): void {
  let version: "1.1" | "1.2" = "1.2";
  let expr: unknown = node;
  if (typeof node === "object" && node !== null && !Array.isArray(node) && "dsl_version" in node) {
    const env = parseEnvelope(node);
    version = env.version;
    expr = env.expr;
  }
  try {
    parseExpression(expr, { scope, version });
  } catch (e) {
    if (e instanceof DslError) throw calError("DSL_INVALID", `${where}: ${e.phase}/${e.reason}`);
    throw e;
  }
}

const HEX256 = /^0x[0-9a-fA-F]{64}$/;
const OWNER_ENVELOPE_KEYS = new Set(["signature", "domain", "timestamp", "workchain", "address_hash"]);

/**
 * `signatures` (§8.1). `operator_sig` (always) and `sponsor_sig` are raw hex Ed25519 bytes.
 * `owner_sig` accepts TWO forms during the §8.4 Tier-2 compatibility window (dual-accept /
 * single-emit; D-S3):
 *   - legacy: a hex-bytes string (schema-tolerated; not verifiable post-D1 — no envelope);
 *   - current: the owner co-signature envelope object (D-S1/D-S2) carrying the Contract A
 *     reconstruction primitives `{ signature, domain, timestamp, workchain, address_hash }`.
 * Reconstruction is exclusively from these CAL-carried fields (D-S4, no backfill).
 */
function validateSignatures(sig: unknown): void {
  const o = asObject(sig, "BAD_SIGNATURES");
  checkUnexpected(o, SIG_KEYS, "UNEXPECTED_SIG_FIELD");
  if (!("operator_sig" in o)) throw calError("MISSING_FIELD", "signatures.operator_sig");

  for (const k of ["operator_sig", "sponsor_sig"]) {
    if (k in o) {
      const v = o[k];
      if (typeof v !== "string" || !HEX_BYTES.test(v)) throw calError("BAD_SIG_BYTES", `signatures.${k}`);
    }
  }

  if ("owner_sig" in o) {
    const v = o["owner_sig"];
    if (typeof v === "string") {
      if (!HEX_BYTES.test(v)) throw calError("BAD_SIG_BYTES", "signatures.owner_sig"); // legacy form
    } else {
      const env = asObject(v, "BAD_OWNER_ENVELOPE");
      checkUnexpected(env, OWNER_ENVELOPE_KEYS, "UNEXPECTED_OWNER_ENVELOPE_FIELD");
      for (const k of OWNER_ENVELOPE_KEYS) {
        if (!(k in env)) throw calError("MISSING_FIELD", `signatures.owner_sig.${k}`);
      }
      if (typeof env["signature"] !== "string" || !HEX_BYTES.test(env["signature"] as string)) throw calError("BAD_SIG_BYTES", "signatures.owner_sig.signature");
      if (typeof env["address_hash"] !== "string" || !HEX256.test(env["address_hash"] as string)) throw calError("BAD_OWNER_ENVELOPE", "signatures.owner_sig.address_hash (expect 0x + 32 bytes)");
      if (typeof env["domain"] !== "string" || env["domain"] === "") throw calError("BAD_OWNER_ENVELOPE", "signatures.owner_sig.domain");
      requireUint(env["timestamp"], UINT64_MAX, "BAD_OWNER_ENVELOPE");
      const wc = env["workchain"];
      if (typeof wc !== "bigint" || wc < -(2n ** 31n) || wc > 2n ** 31n - 1n) throw calError("BAD_OWNER_ENVELOPE", "signatures.owner_sig.workchain (int32)");
    }
  }
}

function validateStep(step: unknown, namespace: string, where: string): void {
  const o = asObject(step, "BAD_STEP");
  checkUnexpected(o, STEP_KEYS, "UNEXPECTED_STEP_FIELD");
  const verb = o["verb"];
  if (typeof verb !== "string") throw calError("BAD_STEP", `${where}.verb`);
  if (!isRegisteredAction(verb)) throw calError("UNKNOWN_VERB", verb);
  if (verb.split(".")[0] !== namespace) throw calError("VERB_NAMESPACE_MISMATCH", `${verb} not in ${namespace}.*`);
  asObject(o["params"], "BAD_PARAMS");
  if ("post_conditions" in o) {
    const pcs = o["post_conditions"];
    if (!Array.isArray(pcs)) throw calError("POSTCONDITIONS_NOT_LIST", where);
    pcs.forEach((pc, i) => validateEmbeddedDsl(pc, "post_condition", `${where}.post_conditions[${i}]`));
  }
}

/**
 * Validate a CAL blob (parsed JcsValue, or canonical JSON text). Returns the
 * parsed CAL object on success; throws `CalError` with a stable `code` (and
 * `detail`) otherwise.
 */
export function validateCal(input: unknown): Record<string, unknown> {
  const cal = asObject(typeof input === "string" ? parseCanonical(input) : input, "NOT_OBJECT");
  checkUnexpected(cal, TOP_LEVEL_KEYS, "UNEXPECTED_FIELD");

  for (const f of ["cal_version", "action", "agent_id", "nonce", "expiration_tick", "preconditions", "invariants", "steps", "receipt_required", "signatures"]) {
    if (!(f in cal)) throw calError("MISSING_FIELD", f);
  }

  if (cal["cal_version"] !== CAL_VERSION) throw calError("BAD_CAL_VERSION", String(cal["cal_version"]));

  const action = cal["action"];
  if (typeof action !== "string" || !isRegisteredAction(action)) throw calError("UNKNOWN_ACTION", String(action));
  const namespace = action.split(".")[0]!;

  if (typeof cal["agent_id"] !== "string" || !isCanonicalAddress(cal["agent_id"])) throw calError("BAD_AGENT_ID");

  requireUint(cal["nonce"], UINT64_MAX, "BAD_NONCE");
  requireUint(cal["expiration_tick"], UINT64_MAX, "BAD_EXPIRATION");

  validateEmbeddedDsl(cal["preconditions"], "precondition", "preconditions");

  const invariants = cal["invariants"];
  if (!Array.isArray(invariants)) throw calError("INVARIANTS_NOT_LIST");
  invariants.forEach((inv, i) => validateEmbeddedDsl(inv, "invariant", `invariants[${i}]`));

  const steps = cal["steps"];
  if (!Array.isArray(steps)) throw calError("STEPS_NOT_LIST");
  if (steps.length === 0) throw calError("EMPTY_STEPS");
  steps.forEach((s, i) => validateStep(s, namespace, `steps[${i}]`));

  if (typeof cal["receipt_required"] !== "boolean") throw calError("BAD_RECEIPT_REQUIRED");

  validateSignatures(cal["signatures"]);

  if ("compatibility_pragma" in cal) {
    if (cal["compatibility_pragma"] !== "v0.9.5") throw calError("BAD_PRAGMA", String(cal["compatibility_pragma"]));
  }
  if ("gas_limit_ptra" in cal) {
    requireUint(cal["gas_limit_ptra"], UINT256_MAX, "BAD_GAS_LIMIT");
  }

  return cal;
}

export interface CheckResult {
  readonly valid: boolean;
  readonly code?: string;
  readonly detail?: string;
}

/** Non-throwing wrapper returning a stable {valid, code, detail} outcome. */
export function checkCal(input: unknown): CheckResult {
  try {
    validateCal(input);
    return { valid: true };
  } catch (e) {
    if (e instanceof Error && "code" in e) {
      const ce = e as { code: string; detail?: string };
      return { valid: false, code: ce.code, ...(ce.detail ? { detail: ce.detail } : {}) };
    }
    throw e;
  }
}
