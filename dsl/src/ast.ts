/**
 * Validated DSL v1.2 AST.
 *
 * The wire form is restricted-JCS JSON (Constraint DSL v1.1 §4); `parse.ts`
 * validates that JSON into the typed `Expr` tree below. Each variant records
 * exactly the operand shape the spec uses:
 *
 *   - binary arithmetic / comparison / (n)eq  →  { op, lhs, rhs }
 *   - and / or                                →  { op, args }      (DSL v1.1 §3.1)
 *   - not / size                              →  { op, arg }
 *   - contains_key                            →  { op, lhs(map), rhs(key) }
 *   - requires_scope / is_owner_required      →  { op, args }      (DSL v1.2 §5.2)
 *   - const / var / action literals           →  leaf nodes
 *
 * Note on shapes the spec leaves implicit: `contains_key` has no normative
 * example, so this implementation fixes it as `{op, lhs, rhs}` (map = lhs,
 * key = rhs); the golden vectors pin that choice for the parity ports.
 */

export type CmpOp = "lt" | "lte" | "gt" | "gte";
export type ArithOp = "add" | "sub" | "mul" | "div" | "mod";
export type EqOp = "eq" | "neq";

export const CMP_OPS: readonly CmpOp[] = ["lt", "lte", "gt", "gte"];
export const ARITH_OPS: readonly ArithOp[] = ["add", "sub", "mul", "div", "mod"];
export const EQ_OPS: readonly EqOp[] = ["eq", "neq"];

/** Inferred static type of a `{const: ...}` literal (DSL v1.1 §2). */
export type ConstType = "int256" | "bool" | "string" | "bytes32" | "address" | "null";

export interface ConstExpr {
  readonly node: "const";
  readonly constType: ConstType;
  /** int256 → bigint; bool → boolean; string/bytes32/address → string; null → null. */
  readonly value: bigint | boolean | string | null;
}

export interface VarExpr {
  readonly node: "var";
  /** Raw dotted path as written, e.g. "state.before.treasury.nav". */
  readonly raw: string;
  /** Dot-split components, e.g. ["state","before","treasury","nav"]. */
  readonly path: readonly string[];
}

export interface ActionExpr {
  readonly node: "action";
  readonly action: string; // "namespace.verb", validated against the taxonomy
}

export interface EqExpr {
  readonly node: "eq";
  readonly op: EqOp;
  readonly lhs: Expr;
  readonly rhs: Expr;
}

export interface CmpExpr {
  readonly node: "cmp";
  readonly op: CmpOp;
  readonly lhs: Expr;
  readonly rhs: Expr;
}

export interface ArithExpr {
  readonly node: "arith";
  readonly op: ArithOp;
  readonly lhs: Expr;
  readonly rhs: Expr;
}

export interface BoolExpr {
  readonly node: "bool";
  readonly op: "and" | "or";
  readonly args: readonly Expr[];
}

export interface NotExpr {
  readonly node: "not";
  readonly arg: Expr;
}

export interface ContainsKeyExpr {
  readonly node: "contains_key";
  readonly map: Expr;
  readonly key: Expr;
}

export interface SizeExpr {
  readonly node: "size";
  readonly arg: Expr;
}

export interface RequiresScopeExpr {
  readonly node: "requires_scope";
  readonly action: Expr;
  readonly scope: Expr;
}

export interface IsOwnerRequiredExpr {
  readonly node: "is_owner_required";
  readonly action: Expr;
}

export type Expr =
  | ConstExpr
  | VarExpr
  | ActionExpr
  | EqExpr
  | CmpExpr
  | ArithExpr
  | BoolExpr
  | NotExpr
  | ContainsKeyExpr
  | SizeExpr
  | RequiresScopeExpr
  | IsOwnerRequiredExpr;

/**
 * Lexical scope in which an expression appears. Determines which variable
 * roots and operators are legal (DSL v1.2 §4–§6).
 */
export type Scope = "precondition" | "post_condition" | "invariant" | "gate";

/** DSL versions this implementation evaluates. */
export type DslVersion = "1.1" | "1.2";

export const AST_LIMITS = {
  MAX_DEPTH: 10, // DSL v1.1 §3.2
  MAX_NODES: 100, // DSL v1.1 §3.2
  MAX_PATH_SEGMENTS: 6, // DSL v1.1 §2 (total dot components, regular paths)
  MAX_PATH_SEGMENTS_BRACKETED: 7, // DSL v1.2 §3 (state.before.* / state.after.*)
  MAX_EXPRESSION_COST: 1000, // DSL v1.1 §3.2
} as const;
