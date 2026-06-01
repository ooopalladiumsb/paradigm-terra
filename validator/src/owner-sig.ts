/**
 * Node-side owner-signature verifier — the real Ed25519 curve arithmetic the
 * validator's {@link ExecutionTrace} `operatorSigPresent` / `ownerSigPresent` booleans
 * depend on. `trace.ts` notes this was "performed outside the validator (deferred) ...
 * so that wiring is in place once curve arithmetic lands"; it lands here. `validate()`
 * stays a pure function over the resulting booleans — this module produces them, BEFORE
 * the trace is built, and is never called from inside `validate()`.
 *
 * Two independent contracts, NO shared serializer (docs/spec/tc-v2-contract-boundaries.md):
 *   Contract A — TC_V2_SIGNDATA_VERIFY_V1 (signData; big-endian; "txt"/"bin"; single sha256)
 *   Contract B — TC_V2_TONPROOF_VERIFY_V1 (ton-proof-item-v2; little-endian; nested sha256)
 *
 * Pinned byte-for-byte to spec/vectors/tc_v2_sig_verify_v1 by test/owner-sig.test.ts, so
 * this validator-side implementation cannot drift from the TS/Rust/Go references.
 * Normative description: docs/spec/tc-v2-sig-verify-v1.md.
 */

import crypto from "node:crypto";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function ed25519PublicKey(pubkeyHex: string): crypto.KeyObject {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(pubkeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
}

function ed25519Verify(digest: Buffer, signatureB64: string, pubkeyHex: string): boolean {
  return crypto.verify(null, digest, ed25519PublicKey(pubkeyHex), Buffer.from(signatureB64, "base64"));
}

// ---------------------------------------------------------------------------
// Contract A — TC_V2_SIGNDATA_VERIFY_V1
// ---------------------------------------------------------------------------

export type SignDataPayload =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "binary"; readonly bytesB64: string };

export interface SignDataInput {
  readonly workchain: number;
  readonly addressHashHex: string;
  readonly domain: string;
  readonly timestamp: number | bigint;
  readonly payload: SignDataPayload;
}

/** sha256 commit a TC v2 wallet signs for `signData` (single envelope, big-endian). */
export function signDataDigest(input: SignDataInput): Buffer {
  let tag: string;
  let payload: Buffer;
  if (input.payload.type === "text") {
    tag = "txt";
    payload = Buffer.from(input.payload.text, "utf8");
  } else {
    tag = "bin";
    payload = Buffer.from(input.payload.bytesB64, "base64");
  }
  const domain = Buffer.from(input.domain, "utf8");

  const wc = Buffer.alloc(4);
  wc.writeInt32BE(input.workchain);
  const dlen = Buffer.alloc(4);
  dlen.writeUInt32BE(domain.length);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(input.timestamp));
  const plen = Buffer.alloc(4);
  plen.writeUInt32BE(payload.length);

  const message = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from("ton-connect/sign-data/", "utf8"),
    wc,
    Buffer.from(input.addressHashHex, "hex"),
    dlen,
    domain,
    ts,
    Buffer.from(tag, "utf8"),
    plen,
    payload,
  ]);
  return crypto.createHash("sha256").update(message).digest();
}

/** Verify a Contract A owner signature. */
export function verifySignData(input: SignDataInput, signatureB64: string, operatorPubkeyHex: string): boolean {
  return ed25519Verify(signDataDigest(input), signatureB64, operatorPubkeyHex);
}

// ---------------------------------------------------------------------------
// Contract B — TC_V2_TONPROOF_VERIFY_V1
// ---------------------------------------------------------------------------

export interface TonProofInput {
  readonly workchain: number;
  readonly addressHashHex: string;
  readonly domain: string;
  readonly timestamp: number | bigint;
  /** The dApp nonce, signed as its literal string bytes (NOT base64-decoded). */
  readonly proofPayload: string;
}

/** sha256 commit a TC v2 wallet signs for `ton_proof` (nested envelope, little-endian). */
export function tonProofDigest(input: TonProofInput): Buffer {
  const domain = Buffer.from(input.domain, "utf8");

  const wc = Buffer.alloc(4);
  wc.writeInt32BE(input.workchain);
  const dlen = Buffer.alloc(4);
  dlen.writeUInt32LE(domain.length);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64LE(BigInt(input.timestamp));

  const inner = Buffer.concat([
    Buffer.from("ton-proof-item-v2/", "utf8"),
    wc,
    Buffer.from(input.addressHashHex, "hex"),
    dlen,
    domain,
    ts,
    Buffer.from(input.proofPayload, "utf8"),
  ]);
  const outer = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from("ton-connect", "utf8"),
    crypto.createHash("sha256").update(inner).digest(),
  ]);
  return crypto.createHash("sha256").update(outer).digest();
}

/** Verify a Contract B ton_proof (operator_pubkey binding, §10.2). */
export function verifyTonProof(input: TonProofInput, signatureB64: string, operatorPubkeyHex: string): boolean {
  return ed25519Verify(tonProofDigest(input), signatureB64, operatorPubkeyHex);
}

// ---------------------------------------------------------------------------
// CAL co-signature → ExecutionTrace booleans (§8.1 / §8.2)
//
// TWO DISTINCT signature-origin chains — do NOT unify (cal-co-signature-envelope.md):
//   operator_sig — raw Ed25519 over canonical CAL bytes, produced by the AGENT RUNTIME with
//                  its local operator key (Exec Spec §8.1/§8.3: "no external ingress channel").
//                  NO TON Connect, NO Contract A, NO envelope.
//   owner_sig    — TON Connect signData/binary, a Contract A commit by a human WALLET (D1).
//                  Carries the envelope (domain/timestamp/address/workchain) so the node can
//                  rebuild the commit.
// ---------------------------------------------------------------------------

/**
 * Compute `ExecutionTrace.operatorSigPresent`: a RAW Ed25519 verify of the agent's operator
 * signature over `canonical_bytes(cal_without_signatures)`. The operator key is held by the
 * agent runtime and signs programmatically — there is no wallet, so this is NOT a Contract A
 * commit. False on any failure → validator emits §9.4 `CAPABILITY_DENIED`.
 */
export function operatorSigPresent(
  calCanonicalBytes: Uint8Array,
  operatorSigB64: string,
  operatorPubkeyHex: string,
): boolean {
  if (!operatorPubkeyHex) return false;
  return crypto.verify(null, calCanonicalBytes, ed25519PublicKey(operatorPubkeyHex), Buffer.from(operatorSigB64, "base64"));
}

/**
 * The owner co-signature envelope. Per §8.3 the OWNER co-signs
 * `canonical_bytes(cal_without_signatures)` via TON Connect `signData`/`binary` (Contract A);
 * the wallet echoes address/domain/timestamp top-level (the D1 finding) so the node can rebuild
 * the commit. `calCanonicalBytesB64 = base64(canonical_bytes(cal_without_signatures))`.
 * (operator_sig has NO envelope — see `operatorSigPresent`.)
 */
export interface OwnerCoSignature {
  readonly calCanonicalBytesB64: string;
  readonly workchain: number;
  readonly addressHashHex: string;
  readonly domain: string;
  readonly timestamp: number | bigint;
  readonly signatureB64: string;
}

/**
 * Compute `ExecutionTrace.ownerSigPresent` from the owner co-signature envelope and the
 * registry `owner_pubkey` (§8.2; required for OWNER_REQUIRED_ACTIONS and Bounded Mode §10.4)
 * via Contract A reconstruction.
 */
export function ownerSigPresent(env: OwnerCoSignature, ownerPubkeyHex: string): boolean {
  if (!ownerPubkeyHex) return false;
  return verifySignData(
    {
      workchain: env.workchain,
      addressHashHex: env.addressHashHex,
      domain: env.domain,
      timestamp: env.timestamp,
      payload: { type: "binary", bytesB64: env.calCanonicalBytesB64 },
    },
    env.signatureB64,
    ownerPubkeyHex,
  );
}
