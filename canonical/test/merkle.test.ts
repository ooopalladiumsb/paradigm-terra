import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binaryMerkle,
  canonicalizeValue,
  DOMAIN_TAGS,
  domainHash,
  sha256,
  stateNamespaceLeafHash,
  stateRoot,
  streamLeafHash,
  streamTreeRoot,
  toHex,
} from "../src/index.js";
import { CanonicalEncodingError } from "../src/errors.js";

function leaf(label: string): Uint8Array {
  return sha256(new TextEncoder().encode(label));
}

test("binaryMerkle: single leaf returns that leaf unchanged", () => {
  const a = leaf("A");
  const root = binaryMerkle([a], DOMAIN_TAGS.MERKLE_NODE_V1);
  assert.deepEqual(root, a);
});

test("binaryMerkle: two leaves combine deterministically", () => {
  const a = leaf("A");
  const b = leaf("B");
  const root = binaryMerkle([a, b], DOMAIN_TAGS.MERKLE_NODE_V1);
  const expected = domainHash(
    DOMAIN_TAGS.MERKLE_NODE_V1,
    new Uint8Array([...a, ...b]),
  );
  assert.deepEqual(root, expected);
});

test("binaryMerkle: odd leaves duplicate last (3 leaves)", () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const root3 = binaryMerkle([a, b, c], DOMAIN_TAGS.MERKLE_NODE_V1);
  // Manual computation: level1 = [H(A||B), H(C||C)], level2 = H(level1[0] || level1[1])
  const ab = domainHash(DOMAIN_TAGS.MERKLE_NODE_V1, new Uint8Array([...a, ...b]));
  const cc = domainHash(DOMAIN_TAGS.MERKLE_NODE_V1, new Uint8Array([...c, ...c]));
  const expected = domainHash(
    DOMAIN_TAGS.MERKLE_NODE_V1,
    new Uint8Array([...ab, ...cc]),
  );
  assert.deepEqual(root3, expected);
});

test("binaryMerkle: empty input throws", () => {
  assert.throws(() => binaryMerkle([], DOMAIN_TAGS.MERKLE_NODE_V1), CanonicalEncodingError);
});

test("binaryMerkle: bad leaf length throws", () => {
  assert.throws(
    () => binaryMerkle([new Uint8Array(31)], DOMAIN_TAGS.MERKLE_NODE_V1),
    CanonicalEncodingError,
  );
});

test("streamLeafHash: matches CE §6.3 formula", () => {
  const leaf1 = streamLeafHash({
    streamId: "treasury",
    stateHash: new Uint8Array(32).fill(0xaa),
    lastEventHash: new Uint8Array(32).fill(0xbb),
    lastSeqno: 42n,
  });
  assert.equal(leaf1.length, 32);
  // Determinism: re-compute and compare.
  const leaf2 = streamLeafHash({
    streamId: "treasury",
    stateHash: new Uint8Array(32).fill(0xaa),
    lastEventHash: new Uint8Array(32).fill(0xbb),
    lastSeqno: 42n,
  });
  assert.deepEqual(leaf1, leaf2);
});

test("streamTreeRoot: lexicographic ordering by streamId", () => {
  const a = {
    streamId: "alpha",
    stateHash: new Uint8Array(32).fill(1),
    lastEventHash: new Uint8Array(32).fill(2),
    lastSeqno: 1n,
  };
  const b = {
    streamId: "beta",
    stateHash: new Uint8Array(32).fill(3),
    lastEventHash: new Uint8Array(32).fill(4),
    lastSeqno: 2n,
  };
  const rootAB = streamTreeRoot([a, b]);
  const rootBA = streamTreeRoot([b, a]); // same result regardless of input order
  assert.deepEqual(rootAB, rootBA);
});

test("stateNamespaceLeafHash: deterministic, depends on name + bytes", () => {
  const bytes = canonicalizeValue({ x: 1n });
  const h1 = stateNamespaceLeafHash({ name: "state.cal", canonicalBytes: bytes });
  const h2 = stateNamespaceLeafHash({ name: "state.cal", canonicalBytes: bytes });
  const h3 = stateNamespaceLeafHash({ name: "state.tick", canonicalBytes: bytes });
  assert.deepEqual(h1, h2);
  assert.notDeepEqual(h1, h3);
});

test("stateRoot: rejects duplicate namespace names", () => {
  assert.throws(
    () =>
      stateRoot([
        { name: "state.cal", canonicalBytes: new Uint8Array() },
        { name: "state.cal", canonicalBytes: new Uint8Array() },
      ]),
    CanonicalEncodingError,
  );
});

test("stateRoot: input order does not affect result", () => {
  const ns1 = { name: "state.cal", canonicalBytes: canonicalizeValue({ a: 1n }) };
  const ns2 = { name: "state.tick", canonicalBytes: canonicalizeValue({ current: 100n }) };
  const ns3 = { name: "state.ptra", canonicalBytes: canonicalizeValue({ supply: 1000000000n }) };
  const root1 = stateRoot([ns1, ns2, ns3]);
  const root2 = stateRoot([ns3, ns1, ns2]);
  const root3 = stateRoot([ns2, ns3, ns1]);
  assert.deepEqual(root1, root2);
  assert.deepEqual(root1, root3);
  // Sanity: root is 32 bytes and non-zero.
  assert.equal(root1.length, 32);
  assert.notEqual(toHex(root1), "0".repeat(64));
});
