/**
 * Structural validation tests (AST limits, arity, scope, version gating).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DslError, expressionCost, parseExpression, run } from "../src/index.js";

function expectThrow(fn: () => unknown, phase: string, reason: string): void {
  try {
    fn();
    assert.fail(`expected ${phase}/${reason}, but no error thrown`);
  } catch (e) {
    assert.ok(e instanceof DslError, `expected DslError, got ${e}`);
    assert.equal(e.phase, phase, `phase`);
    assert.equal(e.reason, reason, `reason`);
  }
}

const PRE = { scope: "precondition", version: "1.2" } as const;

test("depth limit (11 nested) → PARSE_ERROR/DEPTH_LIMIT", () => {
  let e: unknown = { const: true };
  for (let i = 0; i < 11; i++) e = { op: "not", arg: e };
  expectThrow(() => parseExpression(e, PRE), "PARSE_ERROR", "DEPTH_LIMIT");
});

test("node limit (>100 nodes) → PARSE_ERROR/NODE_LIMIT", () => {
  const args = Array.from({ length: 100 }, () => ({ const: true }));
  expectThrow(() => parseExpression({ op: "and", args }, PRE), "PARSE_ERROR", "NODE_LIMIT");
});

test("cost limit → VALIDATION_ERROR/COST_EXCEEDED", () => {
  // 34 × (size:20 + var 5-seg:10) = 1020 > 1000, with ≤100 nodes.
  const args = Array.from({ length: 34 }, () => ({ op: "size", arg: { var: "params.a.b.c.d" } }));
  expectThrow(() => parseExpression({ op: "and", args }, PRE), "VALIDATION_ERROR", "COST_EXCEEDED");
});

test("arity: and with 1 arg → VALIDATION_ERROR/ARITY", () => {
  expectThrow(() => parseExpression({ op: "and", args: [{ const: true }] }, PRE), "VALIDATION_ERROR", "ARITY");
});

test("unexpected key on operator → VALIDATION_ERROR/UNEXPECTED_KEY", () => {
  expectThrow(
    () => parseExpression({ op: "not", arg: { const: true }, extra: 1 }, PRE),
    "VALIDATION_ERROR",
    "UNEXPECTED_KEY",
  );
});

test("multiple discriminants → PARSE_ERROR/MALFORMED_NODE", () => {
  expectThrow(() => parseExpression({ const: 1, op: "not" }, PRE), "PARSE_ERROR", "MALFORMED_NODE");
});

test("unknown variable root → PARSE_ERROR/UNKNOWN_VAR_ROOT", () => {
  expectThrow(() => parseExpression({ op: "eq", lhs: { var: "foo.bar" }, rhs: { const: 0n } }, PRE), "PARSE_ERROR", "UNKNOWN_VAR_ROOT");
});

test("malformed path (trailing dot) → PARSE_ERROR/MALFORMED_PATH", () => {
  expectThrow(() => parseExpression({ op: "eq", lhs: { var: "state.a." }, rhs: { const: 0n } }, PRE), "PARSE_ERROR", "MALFORMED_PATH");
});

test("bracketed path may use 7 segments; 8 is too deep", () => {
  const post = { scope: "post_condition", version: "1.2" } as const;
  // state.before.a.b.c.d.e = 7 segments → OK
  assert.doesNotThrow(() => parseExpression({ op: "gte", lhs: { var: "state.before.a.b.c.d.e" }, rhs: { const: 0n } }, post));
  // 8 segments → too deep
  expectThrow(
    () => parseExpression({ op: "gte", lhs: { var: "state.before.a.b.c.d.e.f" }, rhs: { const: 0n } }, post),
    "PARSE_ERROR",
    "PATH_TOO_DEEP",
  );
});

test("gate-only operator outside gate → PARSE_ERROR/GATE_OP_OUT_OF_SCOPE", () => {
  expectThrow(
    () => parseExpression({ op: "is_owner_required", args: [{ action: "treasury.transfer" }] }, PRE),
    "PARSE_ERROR",
    "GATE_OP_OUT_OF_SCOPE",
  );
});

test("unregistered action literal → PARSE_ERROR/UNKNOWN_ACTION", () => {
  const gate = { scope: "gate", version: "1.2" } as const;
  expectThrow(
    () => parseExpression({ op: "is_owner_required", args: [{ action: "wallet.teleport" }] }, gate),
    "PARSE_ERROR",
    "UNKNOWN_ACTION",
  );
});

test("expressionCost is data-independent and matches the model", () => {
  // gte(1) + var(2 segments → 4) + const(0) = 5
  const cost = expressionCost({ op: "gte", lhs: { var: "state.x" }, rhs: { const: 0n } }, PRE);
  assert.equal(cost, 1 + 2 * 2);
});

test("run() surfaces parse faults as outcome codes (never throws)", () => {
  const out = run({ op: "xor", lhs: { const: 1n }, rhs: { const: 2n } }, PRE);
  assert.equal(out.code, "VALIDATION_ERROR");
  assert.equal(out.reason, "UNKNOWN_OPERATOR");
});
