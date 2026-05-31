// Contract A — TC_V2_SIGNDATA_VERIFY_V1 (reference implementation, TypeScript/JS).
//
// Owner SIGNATURE channel. Big-endian length/timestamp fields, "txt"/"bin" type
// discriminator, SINGLE sha256 envelope. This module is deliberately self-contained:
// it shares NO serialization helper with ton-proof.mjs (Contract B). Reusing one
// channel's helpers for the other is the exact integrator bug the package guards against.
//
// Byte layout (verified against real captures — see docs/draft/tc-v2-sig-verify-v1-draft.md):
//   message = 0xFFFF || "ton-connect/sign-data/" || int32_be(workchain) || address_hash[32]
//           || uint32_be(domain_len) || domain || uint64_be(timestamp)
//           || ("txt"|"bin") || uint32_be(payload_len) || payload
//   digest  = sha256(message)
//   verify  = ed25519_verify(digest, signature, operator_pubkey)

import crypto from 'node:crypto';

const SCHEMA_PREFIX = 'ton-connect/sign-data/';
const enc = (s) => Buffer.from(s, 'utf8');

/** Resolve the signed payload bytes + the 3-byte type discriminator for a signData input. */
function payloadBytes(input) {
  if (input.payload_type === 'text') return { tag: 'txt', bytes: enc(input.payload_text) };
  if (input.payload_type === 'binary') return { tag: 'bin', bytes: Buffer.from(input.payload_b64, 'base64') };
  throw new Error(`signData: unknown payload_type ${JSON.stringify(input.payload_type)}`);
}

/** Build the Contract A message and return its sha256 digest (the bytes ed25519 signs over). */
export function signDataDigest(input) {
  const domain = enc(input.domain);
  const { tag, bytes } = payloadBytes(input);

  const wc = Buffer.alloc(4); wc.writeInt32BE(input.workchain);
  const dlen = Buffer.alloc(4); dlen.writeUInt32BE(domain.length);
  const ts = Buffer.alloc(8); ts.writeBigUInt64BE(BigInt(input.timestamp));
  const plen = Buffer.alloc(4); plen.writeUInt32BE(bytes.length);

  const message = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    enc(SCHEMA_PREFIX),
    wc,
    Buffer.from(input.address_hash_hex, 'hex'),
    dlen, domain,
    ts,
    enc(tag),
    plen, bytes,
  ]);
  return crypto.createHash('sha256').update(message).digest();
}

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function pubKey(hex) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

/** Verify a signData owner signature. Returns {digestHex, ok}. */
export function verifySignData(input, signatureB64, operatorPubkeyHex) {
  const digest = signDataDigest(input);
  const ok = crypto.verify(null, digest, pubKey(operatorPubkeyHex), Buffer.from(signatureB64, 'base64'));
  return { digestHex: digest.toString('hex'), ok };
}
