/**
 * Generate golden vectors for @paradigm-terra/dsl v0.1.0 (DSL v1.2).
 *
 * Each vector pins, for a fixed (expression, scope, version, bindings):
 *   - the normative evaluation OUTCOME and its reason sub-code, and
 *   - the DSL_HASH of the expression under the declared version.
 *
 * Expressions and bindings are stored as canonical-JSON text (restricted JCS)
 * so the Rust and Go parity implementations can re-parse them identically.
 * Once a parity implementation reproduces every outcome and hash byte-for-byte,
 * this suite is promoted to NORMATIVE (mirrors the canonical layer's workflow).
 *
 * Run: `npm run vectors:generate`
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical, toHex, type JcsValue } from "@paradigm-terra/canonical";
import {
  dslHash,
  EMERGENCY_INVARIANTS,
  run,
  type Bindings,
  type DslVersion,
  type Scope,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "golden.json");

const ADDR = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const ADDR2 = "0:83dfd552e63729b472fc4e4a8f8f83d4a8f4f3a3e3e3a3e3e3a3e3e3a3e3e3a3";

interface Spec {
  readonly id: string;
  readonly description: string;
  readonly scope: Scope;
  readonly version: DslVersion;
  readonly expr: JcsValue;
  readonly bindings?: Bindings;
}

const specs: Spec[] = [
  // ---- evaluation: arithmetic & comparison ----
  {
    id: "gte_balance_true",
    description: "precondition: agent PTRA balance ≥ 100_000_000 → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "gte", lhs: { var: `state.ptra.balances.${ADDR}` }, rhs: { const: 100000000n } },
    bindings: { state: { ptra: { balances: { [ADDR]: 200000000n } } } },
  },
  {
    id: "gte_balance_false",
    description: "precondition: balance below threshold → FALSE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "gte", lhs: { var: `state.ptra.balances.${ADDR}` }, rhs: { const: 100000000n } },
    bindings: { state: { ptra: { balances: { [ADDR]: 1n } } } },
  },
  {
    id: "mod_euclidean_negative",
    description: "mod(-5,3)=1 (non-negative Euclidean remainder) → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { op: "mod", lhs: { const: -5n }, rhs: { const: 3n } }, rhs: { const: 1n } },
  },
  {
    id: "div_truncates_toward_zero",
    description: "div(-7,2) = -3 (truncates toward zero) → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { op: "div", lhs: { const: -7n }, rhs: { const: 2n } }, rhs: { const: -3n } },
  },
  {
    id: "add_overflow_error",
    description: "int256 MAX + 1 → ERROR/OVERFLOW",
    scope: "precondition",
    version: "1.2",
    expr: {
      op: "gte",
      lhs: { op: "add", lhs: { const: 2n ** 255n - 1n }, rhs: { const: 1n } },
      rhs: { const: 0n },
    },
  },
  {
    id: "div_by_zero_error",
    description: "division by zero → ERROR/DIV_BY_ZERO",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { op: "div", lhs: { const: 1n }, rhs: { const: 0n } }, rhs: { const: 0n } },
  },
  // ---- equality & null ----
  {
    id: "eq_null_null_true",
    description: "eq(null,null) → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { const: null }, rhs: { const: null } },
  },
  {
    id: "eq_null_int_false",
    description: "eq(null,5) → FALSE (mixed with null allowed)",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { const: null }, rhs: { const: 5n } },
  },
  {
    id: "lt_null_misuse_error",
    description: "lt(null,5) → ERROR/NULL_MISUSE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "lt", lhs: { const: null }, rhs: { const: 5n } },
  },
  {
    id: "lt_type_mismatch",
    description: "lt(string,int) → VALIDATION_ERROR/TYPE_MISMATCH",
    scope: "precondition",
    version: "1.2",
    expr: { op: "lt", lhs: { const: "hello" }, rhs: { const: 5n } },
  },
  // ---- collections ----
  {
    id: "contains_key_true",
    description: "contains_key(state.cal.nonces, addr) → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "contains_key", lhs: { var: "state.cal.nonces" }, rhs: { const: ADDR } },
    bindings: { state: { cal: { nonces: { [ADDR]: 5n } } } },
  },
  {
    id: "size_map_eq",
    description: "size(state.cal.nonces) == 2 → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { op: "size", arg: { var: "state.cal.nonces" } }, rhs: { const: 2n } },
    bindings: { state: { cal: { nonces: { [ADDR]: 5n, [ADDR2]: 9n } } } },
  },
  {
    id: "size_null_zero",
    description: "size(null variable) == 0 → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { op: "size", arg: { var: "state.cal.missing" } }, rhs: { const: 0n } },
    bindings: { state: { cal: { missing: null } } },
  },
  // ---- logical, no short-circuit ----
  {
    id: "and_true",
    description: "and(gte true, eq true) → TRUE",
    scope: "precondition",
    version: "1.2",
    expr: {
      op: "and",
      args: [
        { op: "gte", lhs: { var: "state.ptra.balances." + ADDR }, rhs: { const: 100n } },
        { op: "eq", lhs: { var: "state.registry.frozen_until" }, rhs: { const: 0n } },
      ],
    },
    bindings: { state: { ptra: { balances: { [ADDR]: 100n } }, registry: { frozen_until: 0n } } },
  },
  {
    id: "and_error_dominates",
    description: "and(div-by-zero ERROR, type-mismatch) → ERROR (ERROR dominates)",
    scope: "precondition",
    version: "1.2",
    expr: {
      op: "and",
      args: [
        { op: "eq", lhs: { op: "div", lhs: { const: 1n }, rhs: { const: 0n } }, rhs: { const: 0n } },
        { op: "lt", lhs: { const: "x" }, rhs: { const: 1n } },
      ],
    },
  },
  // ---- bracketed state (post-conditions / invariants) ----
  {
    id: "post_balance_decreased",
    description: "post-condition: state.after.bal < state.before.bal → TRUE",
    scope: "post_condition",
    version: "1.2",
    expr: { op: "lt", lhs: { var: "state.after.bal" }, rhs: { var: "state.before.bal" } },
    bindings: { before: { bal: 100n }, after: { bal: 50n } },
  },
  {
    id: "invariant_nonce_increment",
    description: "invariant: after.nonce == before.nonce + 1 → TRUE",
    scope: "invariant",
    version: "1.2",
    expr: {
      op: "eq",
      lhs: { var: "state.after.nonce" },
      rhs: { op: "add", lhs: { var: "state.before.nonce" }, rhs: { const: 1n } },
    },
    bindings: { before: { nonce: 41n }, after: { nonce: 42n } },
  },
  {
    id: "bare_state_is_before_in_post",
    description: "in post-condition bare state.x ≡ state.before.x → TRUE",
    scope: "post_condition",
    version: "1.2",
    expr: { op: "eq", lhs: { var: "state.bal" }, rhs: { var: "state.before.bal" } },
    bindings: { before: { bal: 7n }, after: { bal: 9n } },
  },
  // ---- capability gates ----
  {
    id: "is_owner_required_true",
    description: "gate: is_owner_required(treasury.transfer) → TRUE",
    scope: "gate",
    version: "1.2",
    expr: { op: "is_owner_required", args: [{ action: "treasury.transfer" }] },
  },
  {
    id: "is_owner_required_false",
    description: "gate: is_owner_required(wallet.send_ton) → FALSE",
    scope: "gate",
    version: "1.2",
    expr: { op: "is_owner_required", args: [{ action: "wallet.send_ton" }] },
  },
  {
    id: "requires_scope_true",
    description: "gate: requires_scope(wallet.send_ton, ton_transfer) → TRUE",
    scope: "gate",
    version: "1.2",
    expr: { op: "requires_scope", args: [{ action: "wallet.send_ton" }, { const: "ton_transfer" }] },
  },
  // ---- scope & structural errors ----
  {
    id: "bracketed_in_precondition_parse_error",
    description: "state.after.* in precondition → PARSE_ERROR/BRACKETED_STATE_OUT_OF_SCOPE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "gte", lhs: { var: "state.after.bal" }, rhs: { const: 0n } },
  },
  {
    id: "gate_var_in_invariant_parse_error",
    description: "capability.* in invariant → PARSE_ERROR/GATE_VAR_OUT_OF_SCOPE",
    scope: "invariant",
    version: "1.2",
    expr: { op: "eq", lhs: { var: "capability.asset_scope.ptra_stake" }, rhs: { const: true } },
  },
  {
    id: "action_in_precondition_parse_error",
    description: "action literal in precondition → PARSE_ERROR/ACTION_OUT_OF_SCOPE",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { action: "wallet.send_ton" }, rhs: { const: "wallet.send_ton" } },
  },
  {
    id: "unknown_operator",
    description: "unknown operator → VALIDATION_ERROR/UNKNOWN_OPERATOR",
    scope: "precondition",
    version: "1.2",
    expr: { op: "xor", lhs: { const: 1n }, rhs: { const: 2n } },
  },
  {
    id: "collection_literal_rejected",
    description: "list literal in const → VALIDATION_ERROR/NO_COLLECTION_LITERAL",
    scope: "precondition",
    version: "1.2",
    expr: { op: "eq", lhs: { const: [1n, 2n] }, rhs: { const: 0n } },
  },
  {
    id: "path_too_deep",
    description: "7-segment regular path → PARSE_ERROR/PATH_TOO_DEEP",
    scope: "precondition",
    version: "1.2",
    expr: { op: "gte", lhs: { var: "state.a.b.c.d.e.f" }, rhs: { const: 0n } },
  },
  {
    id: "v11_rejects_action",
    description: "action literal under dsl_version 1.1 → VALIDATION_ERROR/V11_UNSUPPORTED",
    scope: "gate",
    version: "1.1",
    expr: { op: "is_owner_required", args: [{ action: "treasury.transfer" }] },
  },
];

interface Vector {
  readonly id: string;
  readonly description: string;
  readonly scope: Scope;
  readonly version: DslVersion;
  readonly expr_canonical: string;
  readonly bindings_canonical?: string;
  readonly output: { outcome: string; reason?: string; dsl_hash: string };
}

function bindingsToJcs(b: Bindings): JcsValue {
  const o: Record<string, JcsValue> = {};
  for (const k of ["state", "before", "after", "params", "capability", "signatures"] as const) {
    if (b[k] !== undefined) o[k] = b[k] as JcsValue;
  }
  return o;
}

const vectors: Vector[] = specs.map((s) => {
  const outcome = run(s.expr, { scope: s.scope, version: s.version, bindings: s.bindings });
  const v: Vector = {
    id: s.id,
    description: s.description,
    scope: s.scope,
    version: s.version,
    expr_canonical: serializeCanonical(s.expr),
    ...(s.bindings ? { bindings_canonical: serializeCanonical(bindingsToJcs(s.bindings)) } : {}),
    output: {
      outcome: outcome.code,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      dsl_hash: `0x${toHex(dslHash(s.expr, s.version))}`,
    },
  };
  return v;
});

// Cross-version hash demonstration: identical AST, different domain tag.
const sharedExpr: JcsValue = { op: "gte", lhs: { var: "state.x" }, rhs: { const: 0n } };
const crossVersion = {
  expr_canonical: serializeCanonical(sharedExpr),
  dsl_hash_v1_1: `0x${toHex(dslHash(sharedExpr, "1.1"))}`,
  dsl_hash_v1_2: `0x${toHex(dslHash(sharedExpr, "1.2"))}`,
};

// Emergency (Bounded-Mode) invariant set hashes (DSL v1.2 §7.1).
const emergency = EMERGENCY_INVARIANTS.map((e, i) => ({
  index: i,
  expr_canonical: serializeCanonical(e as JcsValue),
  dsl_hash: `0x${toHex(dslHash(e, "1.2"))}`,
}));

const doc = {
  meta: {
    package: "@paradigm-terra/dsl",
    version: "0.1.0",
    spec_basis: "DSL Specification v0.1.0-draft (DSL v1.2) over Constraint DSL v1.1 (SCF)",
    spec_extensions: "CAL Execution Spec v0.1.0-draft (action taxonomy, gate operators, emergency invariants)",
    generated_at: new Date().toISOString(),
    status:
      "NORMATIVE — generated by the TypeScript reference implementation and verified byte-for-byte by the Rust (dsl-rs) and Go (dsl-go) parity implementations on 2026-05-24 (every evaluation outcome + reason sub-code and every DSL_HASH; 61 checks in Go, full vector + cross-version + emergency coverage in Rust).",
  },
  vectors,
  cross_version: crossVersion,
  emergency_invariants: emergency,
};

await writeFile(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`Wrote ${vectors.length} vectors + ${emergency.length} emergency invariants to ${OUTPUT_PATH}`);
