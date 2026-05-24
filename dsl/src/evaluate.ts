/**
 * Total evaluator for DSL v1.2.
 *
 * Evaluation is a pure, terminating function over a validated `Expr` and a set
 * of bindings. It never throws to the caller of `run`; instead every fault is
 * mapped to one of the normative outcome codes (errors.ts). Internally, faults
 * are carried as `DslError` whose phase is ERROR (runtime: div/0, overflow,
 * missing variable, null misuse) or VALIDATION_ERROR (type mismatch).
 *
 * Determinism notes (must hold across TS / Rust / Go):
 *  - `and`/`or` evaluate ALL arguments (no short-circuit, DSL v1.1 §3.1). When
 *    several arguments fault, ERROR dominates VALIDATION_ERROR, and within a
 *    class the first argument (in order) wins.
 *  - `mod` is the non-negative Euclidean remainder; `div` truncates toward zero.
 *  - bare `state.*` inside post-conditions/invariants binds to `state.before.*`.
 */

import type { DslVersion, Expr, Scope } from "./ast.js";
import { DslError, runtimeError, validationError } from "./errors.js";
import { parseExpression, type ParseOptions } from "./parse.js";
import { isOwnerRequired, requiresScope } from "./taxonomy.js";
import {
  constValue,
  INT256_MAX,
  INT256_MIN,
  keyForm,
  materialize,
  valuesEqual,
  type Value,
} from "./values.js";

export interface Bindings {
  /** Snapshot at VALIDATED — used by `state.*` in preconditions and gates. */
  readonly state?: unknown;
  /** Snapshot bound to `state.before.*` (and bare `state.*` in post/invariants). */
  readonly before?: unknown;
  /** Post-step / post-CAL state bound to `state.after.*`. */
  readonly after?: unknown;
  readonly params?: unknown;
  readonly capability?: unknown;
  readonly signatures?: unknown;
}

export type OutcomeCode =
  | "EVALUATION_TRUE"
  | "EVALUATION_FALSE"
  | "ERROR"
  | "VALIDATION_ERROR"
  | "PARSE_ERROR";

export interface Outcome {
  readonly code: OutcomeCode;
  readonly reason?: string;
}

function requireInt(v: Value): bigint {
  if (v.kind === "int256") return v.int;
  if (v.kind === "null") throw runtimeError("NULL_MISUSE", `arithmetic/comparison on null`);
  throw validationError("TYPE_MISMATCH", `expected int256, got ${v.kind}`);
}

function requireBool(v: Value): boolean {
  if (v.kind === "bool") return v.bool;
  if (v.kind === "null") throw runtimeError("NULL_MISUSE", `boolean operator on null`);
  throw validationError("TYPE_MISMATCH", `expected bool, got ${v.kind}`);
}

function requireString(v: Value): string {
  if (v.kind === "string") return v.str;
  if (v.kind === "null") throw runtimeError("NULL_MISUSE", `string operator on null`);
  throw validationError("TYPE_MISMATCH", `expected string, got ${v.kind}`);
}

function checkRange(v: bigint, op: string): bigint {
  if (v < INT256_MIN || v > INT256_MAX) throw runtimeError("OVERFLOW", `${op} overflowed int256`);
  return v;
}

function euclideanMod(a: bigint, b: bigint): bigint {
  let m = a % b;
  if (m < 0n) m += b < 0n ? -b : b;
  return m;
}

function resolvePath(expr: { raw: string; path: readonly string[] }, b: Bindings, scope: Scope): Value {
  const path = expr.path;
  const root = path[0]!;
  let base: unknown;
  let rest: readonly string[];

  switch (root) {
    case "params":
      base = b.params;
      rest = path.slice(1);
      break;
    case "capability":
      base = b.capability;
      rest = path.slice(1);
      break;
    case "signatures":
      base = b.signatures;
      rest = path.slice(1);
      break;
    case "state":
      if (path[1] === "before") {
        base = b.before;
        rest = path.slice(2);
      } else if (path[1] === "after") {
        base = b.after;
        rest = path.slice(2);
      } else if (scope === "post_condition" || scope === "invariant") {
        base = b.before; // bare state.* ≡ state.before.* in post/invariants (§4.1)
        rest = path.slice(1);
      } else {
        base = b.state;
        rest = path.slice(1);
      }
      break;
    default:
      throw runtimeError("MISSING_VAR", `unbindable root ${root}`);
  }

  if (base === undefined) throw runtimeError("MISSING_VAR", `binding for ${expr.raw} is not provided`);

  let cur: unknown = base;
  for (const seg of rest) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur) || !(seg in (cur as object))) {
      throw runtimeError("MISSING_VAR", `path ${JSON.stringify(expr.raw)} does not resolve (at segment ${JSON.stringify(seg)})`);
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return materialize(cur);
}

function evalNode(expr: Expr, b: Bindings, scope: Scope): Value {
  switch (expr.node) {
    case "const":
      return constValue(expr.constType, expr.value);
    case "var":
      return resolvePath(expr, b, scope);
    case "action":
      return { kind: "string", str: expr.action };
    case "eq": {
      const eq = valuesEqual(evalNode(expr.lhs, b, scope), evalNode(expr.rhs, b, scope));
      return { kind: "bool", bool: expr.op === "eq" ? eq : !eq };
    }
    case "cmp": {
      const l = requireInt(evalNode(expr.lhs, b, scope));
      const r = requireInt(evalNode(expr.rhs, b, scope));
      const res = expr.op === "lt" ? l < r : expr.op === "lte" ? l <= r : expr.op === "gt" ? l > r : l >= r;
      return { kind: "bool", bool: res };
    }
    case "arith": {
      const l = requireInt(evalNode(expr.lhs, b, scope));
      const r = requireInt(evalNode(expr.rhs, b, scope));
      switch (expr.op) {
        case "add":
          return { kind: "int256", int: checkRange(l + r, "add") };
        case "sub":
          return { kind: "int256", int: checkRange(l - r, "sub") };
        case "mul":
          return { kind: "int256", int: checkRange(l * r, "mul") };
        case "div":
          if (r === 0n) throw runtimeError("DIV_BY_ZERO", `division by zero`);
          if (l === INT256_MIN && r === -1n) throw runtimeError("OVERFLOW", `MIN_INT256 / -1 overflows`);
          return { kind: "int256", int: l / r };
        case "mod":
          if (r === 0n) throw runtimeError("MOD_BY_ZERO", `modulo by zero`);
          return { kind: "int256", int: euclideanMod(l, r) };
      }
      break;
    }
    case "bool":
      return evalBoolean(expr, b, scope);
    case "not":
      return { kind: "bool", bool: !requireBool(evalNode(expr.arg, b, scope)) };
    case "contains_key": {
      const m = evalNode(expr.map, b, scope);
      if (m.kind === "null") throw runtimeError("NULL_MISUSE", `contains_key on null`);
      if (m.kind !== "map") throw validationError("TYPE_MISMATCH", `contains_key expects a map, got ${m.kind}`);
      const k = keyForm(evalNode(expr.key, b, scope));
      return { kind: "bool", bool: m.entries.has(k) };
    }
    case "size": {
      const v = evalNode(expr.arg, b, scope);
      if (v.kind === "list") return { kind: "int256", int: BigInt(v.items.length) };
      if (v.kind === "map") return { kind: "int256", int: BigInt(v.entries.size) };
      if (v.kind === "null") return { kind: "int256", int: 0n };
      throw validationError("TYPE_MISMATCH", `size expects list/map/null, got ${v.kind}`);
    }
    case "requires_scope": {
      const action = requireString(evalNode(expr.action, b, scope));
      const scopeName = requireString(evalNode(expr.scope, b, scope));
      return { kind: "bool", bool: requiresScope(action, scopeName) };
    }
    case "is_owner_required": {
      const action = requireString(evalNode(expr.action, b, scope));
      return { kind: "bool", bool: isOwnerRequired(action) };
    }
  }
  // Unreachable for a validated AST.
  throw runtimeError("INTERNAL", `unhandled node`);
}

function evalBoolean(expr: { op: "and" | "or"; args: readonly Expr[] }, b: Bindings, scope: Scope): Value {
  // Evaluate every argument (no short-circuit). ERROR dominates VALIDATION_ERROR.
  const results: ({ value: Value } | { err: DslError })[] = [];
  for (const a of expr.args) {
    try {
      results.push({ value: evalNode(a, b, scope) });
    } catch (e) {
      if (e instanceof DslError) results.push({ err: e });
      else throw e;
    }
  }
  for (const r of results) if ("err" in r && r.err.phase === "ERROR") throw r.err;
  for (const r of results) if ("err" in r && r.err.phase === "VALIDATION_ERROR") throw r.err;

  let acc = expr.op === "and";
  for (const r of results) {
    const bool = requireBool((r as { value: Value }).value);
    acc = expr.op === "and" ? acc && bool : acc || bool;
  }
  return { kind: "bool", bool: acc };
}

/** Evaluate a validated expression against bindings. Never throws. */
export function evaluate(expr: Expr, bindings: Bindings, scope: Scope): Outcome {
  try {
    const v = evalNode(expr, bindings, scope);
    if (v.kind !== "bool") {
      return { code: "VALIDATION_ERROR", reason: "NON_BOOLEAN_RESULT" };
    }
    return { code: v.bool ? "EVALUATION_TRUE" : "EVALUATION_FALSE" };
  } catch (e) {
    if (e instanceof DslError) return { code: e.phase, reason: e.reason };
    throw e;
  }
}

export interface RunOptions extends ParseOptions {
  readonly bindings?: Bindings;
}

/**
 * Parse + evaluate in one call, returning the unified normative outcome
 * (PARSE_ERROR / VALIDATION_ERROR / EVALUATION_TRUE / EVALUATION_FALSE / ERROR).
 * This is the entry point exercised by the golden vectors.
 */
export function run(input: unknown, opts: RunOptions): Outcome {
  let expr: Expr;
  try {
    expr = parseExpression(input, opts);
  } catch (e) {
    if (e instanceof DslError) return { code: e.phase, reason: e.reason };
    throw e;
  }
  return evaluate(expr, opts.bindings ?? {}, opts.scope);
}

export type { DslVersion };
