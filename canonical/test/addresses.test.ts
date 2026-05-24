import { test } from "node:test";
import assert from "node:assert/strict";
import { addressToBytes, formatAddress, isCanonicalAddress, parseAddress } from "../src/addresses.js";
import { CanonicalEncodingError } from "../src/errors.js";

const SAMPLE = "0:83dfd552e63729b472fc4e4a8f8f83d4a8f4f3a3e3e3a3e3e3a3e3e3a3e3e3a3";

test("parse + format round-trip canonical raw address", () => {
  const p = parseAddress(SAMPLE);
  assert.equal(p.workchain, 0);
  assert.equal(p.hash.length, 32);
  assert.equal(formatAddress(p), SAMPLE);
});

test("rejects uppercase hex", () => {
  const upper = SAMPLE.toUpperCase();
  assert.throws(() => parseAddress(upper), CanonicalEncodingError);
});

test("rejects bounceable base64 (EQ...)", () => {
  assert.throws(() => parseAddress("EQCDf9VS5jcpLUcvxOSo+Pg9So9POj4+Pj4+Pj4+Pj4+"), CanonicalEncodingError);
});

test("rejects missing colon", () => {
  assert.throws(() => parseAddress("0" + SAMPLE.slice(2)), CanonicalEncodingError);
});

test("rejects hash length ≠ 64 hex chars", () => {
  assert.throws(() => parseAddress("0:abc"), CanonicalEncodingError);
});

test("workchain -1 (masterchain) parses", () => {
  const addr = `-1:${"f".repeat(64)}`;
  const p = parseAddress(addr);
  assert.equal(p.workchain, -1);
});

test("workchain out of int8 range rejected", () => {
  assert.throws(() => parseAddress(`128:${"0".repeat(64)}`), CanonicalEncodingError);
  assert.throws(() => parseAddress(`-129:${"0".repeat(64)}`), CanonicalEncodingError);
});

test("isCanonicalAddress: true/false", () => {
  assert.equal(isCanonicalAddress(SAMPLE), true);
  assert.equal(isCanonicalAddress("not-an-address"), false);
});

test("addressToBytes: 1 + 32 bytes, workchain encoded as int8", () => {
  const bytes = addressToBytes(SAMPLE);
  assert.equal(bytes.length, 33);
  assert.equal(bytes[0], 0);
  const negBytes = addressToBytes(`-1:${"0".repeat(64)}`);
  assert.equal(negBytes[0], 0xff); // -1 in int8
});
