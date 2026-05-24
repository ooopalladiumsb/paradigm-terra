/**
 * Evaluation semantics tests (operators, types, null, gates, bracketed state).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { run, type Bindings, type Scope } from "../src/index.js";

function outcome(expr: unknown, scope: Scope, bindings?: Bindings, version: "1.1" | "1.2" = "1.2"): string {
  const o = run(expr, { scope, version, bindings });
  return o.code + (o.reason ? `/${o.reason}` : "");
}

test("comparison operators", () => {
  assert.equal(outcome({ op: "lt", lhs: { const: 1n }, rhs: { const: 2n } }, "precondition"), "EVALUATION_TRUE");
  assert.equal(outcome({ op: "lte", lhs: { const: 2n }, rhs: { const: 2n } }, "precondition"), "EVALUATION_TRUE");
  assert.equal(outcome({ op: "gt", lhs: { const: 1n }, rhs: { const: 2n } }, "precondition"), "EVALUATION_FALSE");
  assert.equal(outcome({ op: "gte", lhs: { const: 2n }, rhs: { const: 3n } }, "precondition"), "EVALUATION_FALSE");
});

test("arithmetic: sub/mul and underflow", () => {
  assert.equal(
    outcome({ op: "eq", lhs: { op: "mul", lhs: { const: 6n }, rhs: { const: 7n } }, rhs: { const: 42n } }, "precondition"),
    "EVALUATION_TRUE",
  );
  // MIN - 1 underflows
  assert.equal(
    outcome(
      { op: "gte", lhs: { op: "sub", lhs: { const: -(2n ** 255n) }, rhs: { const: 1n } }, rhs: { const: 0n } },
      "precondition",
    ),
    "ERROR/OVERFLOW",
  );
});

test("mod by zero → ERROR/MOD_BY_ZERO", () => {
  assert.equal(
    outcome({ op: "eq", lhs: { op: "mod", lhs: { const: 5n }, rhs: { const: 0n } }, rhs: { const: 0n } }, "precondition"),
    "ERROR/MOD_BY_ZERO",
  );
});

test("MIN_INT256 / -1 → ERROR/OVERFLOW", () => {
  assert.equal(
    outcome(
      { op: "eq", lhs: { op: "div", lhs: { const: -(2n ** 255n) }, rhs: { const: -1n } }, rhs: { const: 0n } },
      "precondition",
    ),
    "ERROR/OVERFLOW",
  );
});

test("neq and not", () => {
  assert.equal(outcome({ op: "neq", lhs: { const: 1n }, rhs: { const: 2n } }, "precondition"), "EVALUATION_TRUE");
  assert.equal(outcome({ op: "not", arg: { const: false } }, "precondition"), "EVALUATION_TRUE");
});

test("string equality is NFC byte comparison", () => {
  // U+00E9 (é) vs U+0065 U+0301 (e + combining acute) normalize equal under NFC.
  assert.equal(
    outcome({ op: "eq", lhs: { const: "café" }, rhs: { const: "café" } }, "precondition"),
    "EVALUATION_TRUE",
  );
});

test("address equality", () => {
  const a = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
  assert.equal(outcome({ op: "eq", lhs: { const: a }, rhs: { const: a } }, "precondition"), "EVALUATION_TRUE");
});

test("missing variable → ERROR/MISSING_VAR", () => {
  assert.equal(
    outcome({ op: "gte", lhs: { var: "state.ptra.balance" }, rhs: { const: 0n } }, "precondition", { state: { ptra: {} } }),
    "ERROR/MISSING_VAR",
  );
});

test("top-level non-boolean → VALIDATION_ERROR/NON_BOOLEAN_RESULT", () => {
  assert.equal(outcome({ const: 5n }, "precondition"), "VALIDATION_ERROR/NON_BOOLEAN_RESULT");
});

test("or short-circuit-free: ERROR dominates even if a TRUE arg exists", () => {
  assert.equal(
    outcome(
      {
        op: "or",
        args: [
          { op: "gte", lhs: { const: 1n }, rhs: { const: 0n } }, // TRUE
          { op: "eq", lhs: { op: "div", lhs: { const: 1n }, rhs: { const: 0n } }, rhs: { const: 0n } }, // ERROR
        ],
      },
      "precondition",
    ),
    "ERROR/DIV_BY_ZERO",
  );
});

test("contains_key false when key absent", () => {
  const a = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
  assert.equal(
    outcome({ op: "contains_key", lhs: { var: "state.m" }, rhs: { const: a } }, "precondition", { state: { m: {} } }),
    "EVALUATION_FALSE",
  );
});

test("bracketed state forbidden in gate scope", () => {
  assert.equal(
    outcome({ op: "gte", lhs: { var: "state.after.x" }, rhs: { const: 0n } }, "gate"),
    "PARSE_ERROR/BRACKETED_STATE_OUT_OF_SCOPE",
  );
});

test("gate variables resolve in gate scope", () => {
  assert.equal(
    outcome({ op: "eq", lhs: { var: "signatures.owner_sig_valid" }, rhs: { const: true } }, "gate", {
      signatures: { owner_sig_valid: true },
    }),
    "EVALUATION_TRUE",
  );
});

test("v1.1 evaluates shared operators identically", () => {
  assert.equal(
    outcome({ op: "gte", lhs: { const: 5n }, rhs: { const: 3n } }, "precondition", undefined, "1.1"),
    "EVALUATION_TRUE",
  );
});
