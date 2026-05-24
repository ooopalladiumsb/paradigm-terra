/**
 * Golden-vector verification. Re-runs every vector in vectors/golden.json
 * through the reference implementation and asserts the recorded outcome, reason,
 * and DSL_HASH. This is the suite the Rust/Go parity ports must also satisfy.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseCanonical, toHex } from "@paradigm-terra/canonical";
import { dslHash, run, type Bindings, type DslVersion, type Scope } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(__dirname, "..", "vectors", "golden.json"), "utf8"));

function bindingsFrom(text: string | undefined): Bindings | undefined {
  if (text === undefined) return undefined;
  const o = parseCanonical(text) as Record<string, unknown>;
  return o as Bindings;
}

test("golden vectors: outcomes + hashes reproduce", () => {
  assert.ok(Array.isArray(golden.vectors) && golden.vectors.length >= 28);
  for (const v of golden.vectors) {
    const expr = parseCanonical(v.expr_canonical);
    const outcome = run(expr, {
      scope: v.scope as Scope,
      version: v.version as DslVersion,
      bindings: bindingsFrom(v.bindings_canonical),
    });
    assert.equal(outcome.code, v.output.outcome, `${v.id}: outcome`);
    assert.equal(outcome.reason ?? undefined, v.output.reason ?? undefined, `${v.id}: reason`);
    const hash = `0x${toHex(dslHash(expr, v.version as DslVersion))}`;
    assert.equal(hash, v.output.dsl_hash, `${v.id}: dsl_hash`);
  }
});

test("golden vectors: cross-version hashes differ for identical AST", () => {
  const cv = golden.cross_version;
  const expr = parseCanonical(cv.expr_canonical);
  assert.equal(`0x${toHex(dslHash(expr, "1.1"))}`, cv.dsl_hash_v1_1);
  assert.equal(`0x${toHex(dslHash(expr, "1.2"))}`, cv.dsl_hash_v1_2);
  assert.notEqual(cv.dsl_hash_v1_1, cv.dsl_hash_v1_2);
});

test("golden vectors: emergency invariant hashes reproduce", () => {
  assert.equal(golden.emergency_invariants.length, 3);
  for (const e of golden.emergency_invariants) {
    const expr = parseCanonical(e.expr_canonical);
    assert.equal(`0x${toHex(dslHash(expr, "1.2"))}`, e.dsl_hash, `emergency[${e.index}]`);
  }
});
