/**
 * Pins the validator's node-side owner-signature verifier (src/owner-sig.ts) byte-for-byte
 * to the shared golden vectors (../../spec/vectors/tc_v2_sig_verify_v1/). This is the
 * validator's leg of the TC_V2_SIGNDATA_VERIFY_V1 cross-language parity: it cannot drift
 * from the TS/Rust/Go references. Two axes, like the Go suite:
 *   digest  — recompute the contract digest (digest_from_input vectors) == committed hex
 *   verdict — ed25519 over the committed digest == expected verdict
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { signDataDigest, tonProofDigest } from "../src/owner-sig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(__dirname, "..", "..", "spec", "vectors", "tc_v2_sig_verify_v1");

const SPKI = Buffer.from("302a300506032b6570032100", "hex");
function ed25519(digest: Buffer, sigB64: string, pubHex: string): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(pubHex, "hex")]), format: "der", type: "spki" });
  return edVerify(null, digest, key, Buffer.from(sigB64, "base64"));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function load(rel: string): any {
  return JSON.parse(readFileSync(resolve(PKG, rel), "utf8"));
}

function digestFor(contract: string, input: any): Buffer {
  if (contract === "TC_V2_TONPROOF_VERIFY_V1") {
    return tonProofDigest({
      workchain: input.workchain,
      addressHashHex: input.address_hash_hex,
      domain: input.domain,
      timestamp: input.timestamp,
      proofPayload: input.proof_payload,
    });
  }
  return signDataDigest({
    workchain: input.workchain,
    addressHashHex: input.address_hash_hex,
    domain: input.domain,
    timestamp: input.timestamp,
    payload: input.payload_type === "text"
      ? { type: "text", text: input.payload_text }
      : { type: "binary", bytesB64: input.payload_b64 },
  });
}

test("owner-sig verifier matches TC_V2_SIGNDATA_VERIFY_V1 golden vectors", () => {
  const manifest = load("manifest.json");
  const all: string[] = [
    ...manifest.vectors.positive,
    ...manifest.vectors.negative,
    ...manifest.vectors["cross-channel"],
  ];

  let digestChecked = 0;
  let verdictChecked = 0;
  let countA = 0;
  let countB = 0;

  for (const rel of all) {
    const v = load(rel);
    if (v.contract === "TC_V2_TONPROOF_VERIFY_V1") countB++;
    else countA++;

    let digestToVerify = Buffer.from(v.expect.digest_sha256_hex, "hex");
    if (v.digest_from_input) {
      const computed = digestFor(v.contract, v.input);
      assert.equal(computed.toString("hex"), v.expect.digest_sha256_hex, `digest mismatch for ${v.id}`);
      digestToVerify = computed;
      digestChecked++;
    }

    const verdict = ed25519(digestToVerify, v.signature_b64, v.operator_pubkey_hex);
    assert.equal(verdict, v.expect.verdict, `verdict mismatch for ${v.id}`);
    verdictChecked++;
  }

  assert.equal(digestChecked, 15, "digest axis count");
  assert.equal(verdictChecked, 16, "verdict axis count");
  assert.equal(countA, 13, "signData-verifier vector count");
  assert.equal(countB, 3, "tonProof-verifier vector count");
});
