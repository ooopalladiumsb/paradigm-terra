import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeInt256,
  decodeUint256,
  encodeInt256,
  encodeUint16,
  encodeUint256,
  encodeUint64,
  encodeUint8,
  fromHex,
  int256ToHexText,
  toHex,
  uint16ToHexText,
  uint256ToHexText,
  uint64ToHexText,
} from "../src/index.js";
import { CanonicalEncodingError } from "../src/errors.js";

test("uint8: zero, max, out-of-range", () => {
  assert.deepEqual(encodeUint8(0), new Uint8Array([0]));
  assert.deepEqual(encodeUint8(255), new Uint8Array([255]));
  assert.throws(() => encodeUint8(-1), CanonicalEncodingError);
  assert.throws(() => encodeUint8(256), CanonicalEncodingError);
});

test("uint16: zero, max, big-endian", () => {
  assert.deepEqual(encodeUint16(0), new Uint8Array([0, 0]));
  assert.deepEqual(encodeUint16(0xffff), new Uint8Array([0xff, 0xff]));
  assert.deepEqual(encodeUint16(0x1234), new Uint8Array([0x12, 0x34]));
  assert.throws(() => encodeUint16(0x10000), CanonicalEncodingError);
});

test("uint64: zero, max, deterministic", () => {
  assert.deepEqual(encodeUint64(0n), new Uint8Array(8));
  assert.deepEqual(
    encodeUint64((1n << 64n) - 1n),
    new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
  );
  assert.deepEqual(
    encodeUint64(0x0102030405060708n),
    new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
  );
  assert.throws(() => encodeUint64(-1n), CanonicalEncodingError);
  assert.throws(() => encodeUint64(1n << 64n), CanonicalEncodingError);
});

test("uint256: zero, max, round-trip", () => {
  assert.deepEqual(encodeUint256(0n), new Uint8Array(32));
  const max = (1n << 256n) - 1n;
  const maxBytes = encodeUint256(max);
  assert.equal(maxBytes.length, 32);
  for (const b of maxBytes) assert.equal(b, 0xff);
  assert.equal(decodeUint256(maxBytes), max);
  assert.throws(() => encodeUint256(-1n), CanonicalEncodingError);
  assert.throws(() => encodeUint256(1n << 256n), CanonicalEncodingError);
});

test("int256: zero, -1, MIN, MAX, round-trip", () => {
  assert.deepEqual(encodeInt256(0n), new Uint8Array(32));
  const minusOne = encodeInt256(-1n);
  for (const b of minusOne) assert.equal(b, 0xff);
  const min = -(1n << 255n);
  const max = (1n << 255n) - 1n;
  assert.equal(decodeInt256(encodeInt256(min)), min);
  assert.equal(decodeInt256(encodeInt256(max)), max);
  assert.equal(decodeInt256(encodeInt256(-1n)), -1n);
  assert.throws(() => encodeInt256(min - 1n), CanonicalEncodingError);
  assert.throws(() => encodeInt256(max + 1n), CanonicalEncodingError);
});

test("CE §3.1 hex text examples", () => {
  // 0 → 0x0000...0000 (64 hex chars)
  assert.equal(
    int256ToHexText(0n),
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  );
  // -1 → 0xffff...ffff
  assert.equal(
    int256ToHexText(-1n),
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  );
  assert.equal(
    uint256ToHexText(0n),
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  );
  assert.equal(uint64ToHexText(0n), "0x0000000000000000");
  assert.equal(uint64ToHexText(1n), "0x0000000000000001");
  assert.equal(uint16ToHexText(0), "0x0000");
  assert.equal(uint16ToHexText(0xabcd), "0xabcd");
});

test("hex: round-trip, accepts uppercase, rejects odd/invalid", () => {
  const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  assert.equal(toHex(bytes), "deadbeef");
  assert.equal(toHex(bytes, true), "0xdeadbeef");
  assert.deepEqual(fromHex("deadbeef"), bytes);
  assert.deepEqual(fromHex("DEADBEEF"), bytes);
  assert.deepEqual(fromHex("0xDeAdBeEf"), bytes);
  assert.throws(() => fromHex("abc"), CanonicalEncodingError);
  assert.throws(() => fromHex("zzzz"), CanonicalEncodingError);
});
