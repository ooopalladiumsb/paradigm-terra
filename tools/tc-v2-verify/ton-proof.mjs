// Contract B — TC_V2_TONPROOF_VERIFY_V1 (reference implementation, TypeScript/JS).
//
// Owner AUTHENTICATION channel (ton-proof-item-v2). LITTLE-endian length/timestamp,
// NO type discriminator, NESTED sha256 envelope. Self-contained: shares NO
// serialization helper with sign-data.mjs (Contract A) — the conventions genuinely
// differ (BE vs LE, single vs nested hash) and must not be unified.
//
// Byte layout (verified against a real capture — see docs/draft/tc-v2-sig-verify-v1-draft.md):
//   inner  = "ton-proof-item-v2/" || int32_be(workchain) || address_hash[32]
//          || uint32_le(domain_len) || domain || uint64_le(timestamp)
//          || proof_payload          (the dApp nonce, as its LITERAL string bytes)
//   outer  = 0xFFFF || "ton-connect" || sha256(inner)
//   digest = sha256(outer)
//   verify = ed25519_verify(digest, signature, operator_pubkey)

import crypto from 'node:crypto';

const PROOF_PREFIX = 'ton-proof-item-v2/';
const OUTER_PREFIX = 'ton-connect';
const enc = (s) => Buffer.from(s, 'utf8');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

/** Build the Contract B message and return its (nested) sha256 digest. */
export function tonProofDigest(input) {
  const domain = enc(input.domain);

  const wc = Buffer.alloc(4); wc.writeInt32BE(input.workchain); // workchain BE (see residual note §4)
  const dlen = Buffer.alloc(4); dlen.writeUInt32LE(domain.length);
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(input.timestamp));

  const inner = Buffer.concat([
    enc(PROOF_PREFIX),
    wc,
    Buffer.from(input.address_hash_hex, 'hex'),
    dlen, domain,
    ts,
    enc(input.proof_payload), // literal nonce string bytes — NOT base64-decoded
  ]);

  const outer = Buffer.concat([Buffer.from([0xff, 0xff]), enc(OUTER_PREFIX), sha256(inner)]);
  return sha256(outer);
}

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function pubKey(hex) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

/** Verify a ton_proof. Returns {digestHex, ok}. */
export function verifyTonProof(input, signatureB64, operatorPubkeyHex) {
  const digest = tonProofDigest(input);
  const ok = crypto.verify(null, digest, pubKey(operatorPubkeyHex), Buffer.from(signatureB64, 'base64'));
  return { digestHex: digest.toString('hex'), ok };
}
