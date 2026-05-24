import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFrame, encodeFrame } from "../src/framing.js";
import { CanonicalEncodingError } from "../src/errors.js";

test("encode + decode round-trip", () => {
  const frame = { typeTag: 0x0042, version: 0x0001, payload: new Uint8Array([1, 2, 3, 4, 5]) };
  const bytes = encodeFrame(frame);
  assert.equal(bytes.length, 8 + 5);
  // Manual byte check: [00 42][00 01][00 00 00 05][01 02 03 04 05]
  assert.deepEqual(
    bytes,
    new Uint8Array([0x00, 0x42, 0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 1, 2, 3, 4, 5]),
  );
  const decoded = decodeFrame(bytes);
  assert.equal(decoded.typeTag, 0x0042);
  assert.equal(decoded.version, 0x0001);
  assert.deepEqual(decoded.payload, new Uint8Array([1, 2, 3, 4, 5]));
});

test("empty payload allowed", () => {
  const bytes = encodeFrame({ typeTag: 0, version: 0, payload: new Uint8Array() });
  assert.equal(bytes.length, 8);
  const dec = decodeFrame(bytes);
  assert.equal(dec.payload.length, 0);
});

test("rejects out-of-range type_tag / version", () => {
  assert.throws(
    () => encodeFrame({ typeTag: 0x10000, version: 0, payload: new Uint8Array() }),
    CanonicalEncodingError,
  );
  assert.throws(
    () => encodeFrame({ typeTag: 0, version: -1, payload: new Uint8Array() }),
    CanonicalEncodingError,
  );
});

test("decode rejects short input", () => {
  assert.throws(() => decodeFrame(new Uint8Array(4)), CanonicalEncodingError);
});

test("decode rejects length mismatch", () => {
  const bad = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 5, 1, 2, 3]);
  assert.throws(() => decodeFrame(bad), CanonicalEncodingError);
});
