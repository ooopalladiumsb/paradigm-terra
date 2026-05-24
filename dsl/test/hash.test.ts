/**
 * DSL_HASH tests: determinism, key-order independence, version-tag separation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toHex } from "@paradigm-terra/canonical";
import { dslHash, EMERGENCY_INVARIANTS, parseEnvelope } from "../src/index.js";

const hex = (b: Uint8Array) => `0x${toHex(b)}`;

test("hash is deterministic and 32 bytes", () => {
  const e = { op: "gte", lhs: { var: "state.x" }, rhs: { const: 0n } };
  const h1 = dslHash(e, "1.2");
  const h2 = dslHash(e, "1.2");
  assert.equal(h1.length, 32);
  assert.equal(hex(h1), hex(h2));
});

test("hash is independent of object key order (canonicalization)", () => {
  const a = { op: "gte", lhs: { var: "state.x" }, rhs: { const: 0n } };
  const b = { rhs: { const: 0n }, lhs: { var: "state.x" }, op: "gte" };
  assert.equal(hex(dslHash(a, "1.2")), hex(dslHash(b, "1.2")));
});

test("v1.1 and v1.2 domain tags produce different hashes", () => {
  const e = { op: "gte", lhs: { var: "state.x" }, rhs: { const: 0n } };
  assert.notEqual(hex(dslHash(e, "1.1")), hex(dslHash(e, "1.2")));
});

test("emergency invariant set has 3 expressions with distinct hashes", () => {
  assert.equal(EMERGENCY_INVARIANTS.length, 3);
  const hashes = new Set(EMERGENCY_INVARIANTS.map((e) => hex(dslHash(e, "1.2"))));
  assert.equal(hashes.size, 3);
});

test("parseEnvelope accepts 1.1 / 1.2 and rejects others", () => {
  assert.equal(parseEnvelope({ dsl_version: "1.2", expr: { const: true } }).version, "1.2");
  assert.equal(parseEnvelope({ dsl_version: "1.1", expr: { const: true } }).version, "1.1");
  assert.throws(() => parseEnvelope({ dsl_version: "2.0", expr: { const: true } }));
  assert.throws(() => parseEnvelope({ expr: { const: true } }));
});
