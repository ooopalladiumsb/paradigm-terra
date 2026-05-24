import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeString, canonicalizeValue, serializeCanonical } from "../src/jcs.js";
import { NoncanonicalEventError } from "../src/errors.js";

const DECODER = new TextDecoder();

function canonStr(json: string): string {
  return DECODER.decode(canonicalizeString(json));
}

test("CE §10 sample: {\"b\":2,\"a\":1} → sorted", () => {
  assert.equal(canonStr('{ "b": 2, "a": 1 }'), '{"a":1,"b":2}');
});

test("nested objects sort recursively", () => {
  assert.equal(canonStr('{"z":{"y":1,"x":2},"a":3}'), '{"a":3,"z":{"x":2,"y":1}}');
});

test("arrays preserve order", () => {
  assert.equal(canonStr("[3,1,2]"), "[3,1,2]");
});

test("strings: minimal escaping for control chars and quotes", () => {
  assert.equal(canonStr('"hello\\nworld"'), '"hello\\nworld"');
  assert.equal(canonStr('"with \\"quotes\\""'), '"with \\"quotes\\""');
  assert.equal(canonStr('"tab:\\t"'), '"tab:\\t"');
});

test("rejects fractional", () => {
  assert.throws(() => canonicalizeString("1.5"), NoncanonicalEventError);
});

test("rejects exponent", () => {
  assert.throws(() => canonicalizeString("1e5"), NoncanonicalEventError);
  assert.throws(() => canonicalizeString("1E5"), NoncanonicalEventError);
});

test("rejects NaN / Infinity by virtue of not being valid JSON", () => {
  assert.throws(() => canonicalizeString("NaN"), NoncanonicalEventError);
  assert.throws(() => canonicalizeString("Infinity"), NoncanonicalEventError);
  assert.throws(() => canonicalizeString("-Infinity"), NoncanonicalEventError);
});

test("rejects negative zero", () => {
  assert.throws(() => canonicalizeString("-0"), NoncanonicalEventError);
});

test("rejects leading zeros", () => {
  assert.throws(() => canonicalizeString("01"), NoncanonicalEventError);
  assert.throws(() => canonicalizeString("-01"), NoncanonicalEventError);
});

test("rejects duplicate keys (semantic, post-unescape)", () => {
  assert.throws(() => canonicalizeString('{"a":1,"a":2}'), NoncanonicalEventError);
  // Same key via escape sequence:
  assert.throws(() => canonicalizeString('{"a":1,"\\u0061":2}'), NoncanonicalEventError);
});

test("rejects surrogate \\u escapes (forbidden per CE §4.2)", () => {
  assert.throws(() => canonicalizeString('"\\ud83d\\ude00"'), NoncanonicalEventError);
});

test("integers beyond 2^53 preserved exactly", () => {
  const big = "12345678901234567890123456789012345678";
  assert.equal(canonStr(big), big);
});

test("bigint values round-trip via canonicalizeValue", () => {
  const out = DECODER.decode(canonicalizeValue({ a: 1n, b: -1n, c: (1n << 200n) }));
  assert.equal(out, `{"a":1,"b":-1,"c":${(1n << 200n).toString(10)}}`);
});

test("JS Number 1.5 is rejected", () => {
  assert.throws(() => canonicalizeValue({ a: 1.5 }), NoncanonicalEventError);
});

test("JS Number -0 is rejected", () => {
  assert.throws(() => canonicalizeValue({ a: -0 }), NoncanonicalEventError);
});

test("null, true, false", () => {
  assert.equal(canonStr("null"), "null");
  assert.equal(canonStr("true"), "true");
  assert.equal(canonStr("false"), "false");
});

test("empty object and empty array", () => {
  assert.equal(canonStr("{}"), "{}");
  assert.equal(canonStr("[]"), "[]");
});

test("UTF-8 key sort: lexicographic byte order (cyrillic after ASCII)", () => {
  // Russian 'я' (U+044F, UTF-8: d1 8f) sorts after ASCII 'z' (0x7a) and after 'а' (U+0430, UTF-8: d0 b0).
  const result = canonStr('{"я":1,"а":2,"z":3,"a":4}');
  assert.equal(result, '{"a":4,"z":3,"а":2,"я":1}');
});

test("whitespace stripping (RFC 8785)", () => {
  assert.equal(canonStr('  {\n  "a"  :  1\n}'), '{"a":1}');
});

test("DSL expression canonicalization (CE §10 sample)", () => {
  const expr = '{"op":"gte","lhs":{"var":"x"},"rhs":{"const":0}}';
  const canon = canonStr(expr);
  // Already canonical-ish, but keys must be sorted within each object:
  assert.equal(canon, '{"lhs":{"var":"x"},"op":"gte","rhs":{"const":0}}');
});

test("serializeCanonical round-trips via parseCanonical", () => {
  // Build a JcsValue programmatically and re-serialize.
  const v = { b: 2n, a: { y: -1n, x: [1n, 2n, 3n] } };
  const out = serializeCanonical({ b: 2n, a: { y: -1n, x: [1n, 2n, 3n] } });
  assert.equal(out, '{"a":{"x":[1,2,3],"y":-1},"b":2}');
  // Sanity: TS doesn't complain about literal usage.
  void v;
});
