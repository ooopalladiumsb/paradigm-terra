/**
 * Parser / structural validator for DSL v1.2.
 *
 * `parseExpression` turns restricted-JCS JSON into a typed, validated `Expr`,
 * or throws a `DslError` whose phase is PARSE_ERROR (malformed structure, scope
 * violation, path too deep) or VALIDATION_ERROR (unknown operator, bad arity,
 * cost exceeded, malformed literal). Everything checked here is decidable from
 * the AST alone — no state binding required — so two implementations reach the
 * same verdict for the same (expression, scope, version).
 */

import { parseCanonical } from "@paradigm-terra/canonical";
import {
  ARITH_OPS,
  AST_LIMITS,
  CMP_OPS,
  type ArithOp,
  type CmpOp,
  type DslVersion,
  type Expr,
  type Scope,
} from "./ast.js";
import { parseError, validationError } from "./errors.js";
import { isRegisteredAction } from "./taxonomy.js";
import { inInt256Range } from "./values.js";

const ARITH_SET = new Set<string>(ARITH_OPS);
const CMP_SET = new Set<string>(CMP_OPS);
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

// Per-operator-node cost (DSL v1.1 §3.2, CAL §9.2). Path cost is per-segment.
const COST = { binary: 1, contains_key: 10, size: 20, gate_op: 5, path_segment: 2 } as const;

interface Ctx {
  readonly scope: Scope;
  readonly version: DslVersion;
  nodes: number;
  cost: number;
}

type JcsObject = { readonly [k: string]: unknown };

function isObject(j: unknown): j is JcsObject {
  return typeof j === "object" && j !== null && !Array.isArray(j);
}

function keysOf(o: JcsObject): string[] {
  return Object.keys(o);
}

function bumpNode(ctx: Ctx): void {
  ctx.nodes += 1;
  if (ctx.nodes > AST_LIMITS.MAX_NODES) {
    throw parseError("NODE_LIMIT", `AST exceeds ${AST_LIMITS.MAX_NODES} nodes`);
  }
}

function addCost(ctx: Ctx, c: number): void {
  ctx.cost += c;
  if (ctx.cost > AST_LIMITS.MAX_EXPRESSION_COST) {
    throw validationError("COST_EXCEEDED", `expression cost exceeds ${AST_LIMITS.MAX_EXPRESSION_COST}`);
  }
}

function buildConst(value: unknown): Expr {
  if (typeof value === "bigint") {
    if (!inInt256Range(value)) {
      throw validationError("INT256_RANGE", `const integer ${value} is outside the int256 range`);
    }
    return { node: "const", constType: "int256", value };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw validationError("INT256_RANGE", `const number ${value} is not an integer`);
    }
    return { node: "const", constType: "int256", value: BigInt(value) };
  }
  if (typeof value === "boolean") {
    return { node: "const", constType: "bool", value };
  }
  if (value === null) {
    return { node: "const", constType: "null", value: null };
  }
  if (typeof value === "string") {
    // Address and bytes32 take priority over plain string (DSL v1.1 §2).
    if (BYTES32_RE.test(value)) {
      return { node: "const", constType: "bytes32", value: `0x${value.slice(2).toLowerCase()}` };
    }
    // Canonical address detection is delegated to value construction at eval
    // time; here we tag literals that match the workchain:hex256 shape.
    if (/^-?\d+:[0-9a-f]{64}$/.test(value)) {
      return { node: "const", constType: "address", value };
    }
    return { node: "const", constType: "string", value };
  }
  throw validationError("NO_COLLECTION_LITERAL", `const must be a scalar (int/bool/string/null); lists and maps come only from state`);
}

function buildVar(ctx: Ctx, raw: string): Expr {
  if (raw.length === 0 || raw.startsWith(".") || raw.endsWith(".") || raw.includes("..")) {
    throw parseError("MALFORMED_PATH", `malformed variable path ${JSON.stringify(raw)}`);
  }
  const path = raw.split(".");
  const root = path[0]!;

  const bracketed = root === "state" && (path[1] === "before" || path[1] === "after");

  // Path-depth limit (DSL v1.1 §2, raised to 6 segments for bracketed in v1.2 §3).
  const limit = bracketed ? AST_LIMITS.MAX_PATH_SEGMENTS_BRACKETED : AST_LIMITS.MAX_PATH_SEGMENTS;
  if (path.length > limit) {
    throw parseError("PATH_TOO_DEEP", `path ${JSON.stringify(raw)} has ${path.length} segments (limit ${limit})`);
  }

  // Root + scope enforcement (DSL v1.2 §4.1, §6.3).
  switch (root) {
    case "params":
      break;
    case "state":
      if (bracketed) {
        if (ctx.scope !== "post_condition" && ctx.scope !== "invariant") {
          throw parseError(
            "BRACKETED_STATE_OUT_OF_SCOPE",
            `state.${path[1]}.* is only valid in post-conditions and invariants, not ${ctx.scope}`,
          );
        }
        if (ctx.version === "1.1") {
          throw validationError("V11_UNSUPPORTED", `state.${path[1]}.* requires dsl_version 1.2`);
        }
      }
      break;
    case "capability":
    case "signatures":
      if (ctx.scope !== "gate") {
        throw parseError("GATE_VAR_OUT_OF_SCOPE", `${root}.* is gate-only, not valid in ${ctx.scope}`);
      }
      break;
    default:
      throw parseError("UNKNOWN_VAR_ROOT", `unknown variable root ${JSON.stringify(root)}`);
  }

  addCost(ctx, COST.path_segment * path.length);
  return { node: "var", raw, path };
}

function buildAction(ctx: Ctx, action: unknown): Expr {
  if (typeof action !== "string") {
    throw parseError("MALFORMED_ACTION", `action literal must be a string`);
  }
  if (ctx.scope !== "gate") {
    throw parseError("ACTION_OUT_OF_SCOPE", `action literal is gate-only, not valid in ${ctx.scope}`);
  }
  if (ctx.version === "1.1") {
    throw validationError("V11_UNSUPPORTED", `action literal requires dsl_version 1.2`);
  }
  if (!isRegisteredAction(action)) {
    throw parseError("UNKNOWN_ACTION", `action ${JSON.stringify(action)} is not in the registered taxonomy (CAL §2.3)`);
  }
  return { node: "action", action };
}

function expectArgs(o: JcsObject, n: number, op: string): unknown[] {
  const args = o["args"];
  if (!Array.isArray(args)) {
    throw validationError("ARITY", `operator ${op} requires an "args" array`);
  }
  if (args.length !== n) {
    throw validationError("ARITY", `operator ${op} requires ${n} argument(s), got ${args.length}`);
  }
  return args as unknown[];
}

function buildOp(ctx: Ctx, o: JcsObject, depth: number): Expr {
  const op = o["op"];
  if (typeof op !== "string") {
    throw parseError("MALFORMED_NODE", `"op" must be a string`);
  }
  const ks = keysOf(o);

  const requireKeys = (allowed: readonly string[]): void => {
    for (const k of ks) {
      if (!allowed.includes(k)) throw validationError("UNEXPECTED_KEY", `operator ${op} has unexpected key ${JSON.stringify(k)}`);
    }
  };

  // Binary arithmetic / comparison: { op, lhs, rhs }
  if (ARITH_SET.has(op) || CMP_SET.has(op)) {
    requireKeys(["op", "lhs", "rhs"]);
    if (!("lhs" in o) || !("rhs" in o)) throw validationError("ARITY", `operator ${op} requires lhs and rhs`);
    addCost(ctx, COST.binary);
    const lhs = build(ctx, o["lhs"], depth + 1);
    const rhs = build(ctx, o["rhs"], depth + 1);
    if (ARITH_SET.has(op)) return { node: "arith", op: op as ArithOp, lhs, rhs };
    return { node: "cmp", op: op as CmpOp, lhs, rhs };
  }

  switch (op) {
    case "eq":
    case "neq": {
      requireKeys(["op", "lhs", "rhs"]);
      if (!("lhs" in o) || !("rhs" in o)) throw validationError("ARITY", `operator ${op} requires lhs and rhs`);
      addCost(ctx, COST.binary);
      return { node: "eq", op, lhs: build(ctx, o["lhs"], depth + 1), rhs: build(ctx, o["rhs"], depth + 1) };
    }
    case "and":
    case "or": {
      requireKeys(["op", "args"]);
      const args = o["args"];
      if (!Array.isArray(args)) throw validationError("ARITY", `operator ${op} requires an "args" array`);
      if (args.length < 2) throw validationError("ARITY", `operator ${op} requires at least 2 arguments, got ${args.length}`);
      addCost(ctx, COST.binary);
      return { node: "bool", op, args: (args as unknown[]).map((a) => build(ctx, a, depth + 1)) };
    }
    case "not": {
      requireKeys(["op", "arg"]);
      if (!("arg" in o)) throw validationError("ARITY", `operator not requires "arg"`);
      addCost(ctx, COST.binary);
      return { node: "not", arg: build(ctx, o["arg"], depth + 1) };
    }
    case "size": {
      requireKeys(["op", "arg"]);
      if (!("arg" in o)) throw validationError("ARITY", `operator size requires "arg"`);
      addCost(ctx, COST.size);
      return { node: "size", arg: build(ctx, o["arg"], depth + 1) };
    }
    case "contains_key": {
      requireKeys(["op", "lhs", "rhs"]);
      if (!("lhs" in o) || !("rhs" in o)) throw validationError("ARITY", `operator contains_key requires lhs (map) and rhs (key)`);
      addCost(ctx, COST.contains_key);
      return { node: "contains_key", map: build(ctx, o["lhs"], depth + 1), key: build(ctx, o["rhs"], depth + 1) };
    }
    case "requires_scope": {
      if (ctx.scope !== "gate") throw parseError("GATE_OP_OUT_OF_SCOPE", `requires_scope is gate-only, not valid in ${ctx.scope}`);
      if (ctx.version === "1.1") throw validationError("V11_UNSUPPORTED", `requires_scope requires dsl_version 1.2`);
      requireKeys(["op", "args"]);
      const [a, s] = expectArgs(o, 2, op);
      addCost(ctx, COST.gate_op);
      return { node: "requires_scope", action: build(ctx, a, depth + 1), scope: build(ctx, s, depth + 1) };
    }
    case "is_owner_required": {
      if (ctx.scope !== "gate") throw parseError("GATE_OP_OUT_OF_SCOPE", `is_owner_required is gate-only, not valid in ${ctx.scope}`);
      if (ctx.version === "1.1") throw validationError("V11_UNSUPPORTED", `is_owner_required requires dsl_version 1.2`);
      requireKeys(["op", "args"]);
      const [a] = expectArgs(o, 1, op);
      addCost(ctx, COST.gate_op);
      return { node: "is_owner_required", action: build(ctx, a, depth + 1) };
    }
    default:
      throw validationError("UNKNOWN_OPERATOR", `unknown operator ${JSON.stringify(op)}`);
  }
}

function build(ctx: Ctx, j: unknown, depth: number): Expr {
  if (depth > AST_LIMITS.MAX_DEPTH) {
    throw parseError("DEPTH_LIMIT", `AST exceeds depth ${AST_LIMITS.MAX_DEPTH}`);
  }
  bumpNode(ctx);

  if (!isObject(j)) {
    throw parseError("MALFORMED_NODE", `expected an object node, got ${Array.isArray(j) ? "array" : typeof j}`);
  }

  const hasConst = "const" in j;
  const hasVar = "var" in j;
  const hasAction = "action" in j;
  const hasOp = "op" in j;
  const discriminants = [hasConst, hasVar, hasAction, hasOp].filter(Boolean).length;
  if (discriminants !== 1) {
    throw parseError("MALFORMED_NODE", `node must have exactly one of const/var/action/op (found ${discriminants})`);
  }

  if (hasConst) {
    if (keysOf(j).length !== 1) throw parseError("MALFORMED_NODE", `const node must have only the "const" key`);
    return buildConst(j["const"]);
  }
  if (hasVar) {
    if (keysOf(j).length !== 1) throw parseError("MALFORMED_NODE", `var node must have only the "var" key`);
    const raw = j["var"];
    if (typeof raw !== "string") throw parseError("MALFORMED_NODE", `var must be a string path`);
    return buildVar(ctx, raw);
  }
  if (hasAction) {
    if (keysOf(j).length !== 1) throw parseError("MALFORMED_NODE", `action node must have only the "action" key`);
    return buildAction(ctx, j["action"]);
  }
  return buildOp(ctx, j, depth);
}

export interface ParseOptions {
  readonly scope: Scope;
  readonly version: DslVersion;
}

/** Parse + validate an expression AST (already-parsed JCS value or JSON text). */
export function parseExpression(input: unknown, opts: ParseOptions): Expr {
  const j = typeof input === "string" ? parseCanonical(input) : input;
  const ctx: Ctx = { scope: opts.scope, version: opts.version, nodes: 0, cost: 0 };
  return build(ctx, j, 1);
}

/** The static, data-independent cost of a parsed expression (DSL v1.1 §3.2). */
export function expressionCost(input: unknown, opts: ParseOptions): number {
  const j = typeof input === "string" ? parseCanonical(input) : input;
  const ctx: Ctx = { scope: opts.scope, version: opts.version, nodes: 0, cost: 0 };
  build(ctx, j, 1);
  return ctx.cost;
}
