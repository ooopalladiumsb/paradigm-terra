import { test } from "node:test";
import assert from "node:assert/strict";
import { domainHash, sha256, toHex } from "../src/index.js";
import { CanonicalEncodingError } from "../src/errors.js";

test("sha256 of empty input matches known", () => {
  const h = sha256(new Uint8Array());
  assert.equal(toHex(h), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256 of 'abc' matches known", () => {
  const h = sha256(new TextEncoder().encode("abc"));
  assert.equal(toHex(h), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("domainHash applies tag prefix", () => {
  const payload = new TextEncoder().encode("payload");
  const expected = sha256(new TextEncoder().encode("TAG" + "payload"));
  const got = domainHash("TAG", payload);
  assert.deepEqual(got, expected);
});

test("non-ASCII domain tag rejected", () => {
  assert.throws(() => domainHash("ТАГ", new Uint8Array()), CanonicalEncodingError);
  assert.throws(() => domainHash("", new Uint8Array()), CanonicalEncodingError);
});

test("domain separation prevents collision", () => {
  const payload = new TextEncoder().encode("x");
  const h1 = domainHash("DOMAIN_A", payload);
  const h2 = domainHash("DOMAIN_B", payload);
  assert.notDeepEqual(h1, h2);
});
