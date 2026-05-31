// Independent checker for the committed TC_V2_SIGNDATA_VERIFY_V1 golden vectors.
//
// Re-loads every vector from spec/vectors/tc_v2_sig_verify_v1/ and re-derives the
// verdict with the TS reference impl — independent of the generator. Also re-derives
// each positive's digest and checks it byte-matches the committed digest_sha256_hex
// (this is the value Rust/Go must reproduce bit-identically at the parity stage).
//
//   node tools/tc-v2-verify/run-vectors.mjs
//
// This is the TypeScript leg of the cross-language parity harness (tools/parity/, Stage 5).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signDataDigest } from './sign-data.mjs';
import { tonProofDigest } from './ton-proof.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PKG = path.join(ROOT, 'spec/vectors/tc_v2_sig_verify_v1');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'manifest.json'), 'utf8'));
const all = [...manifest.vectors.positive, ...manifest.vectors.negative, ...manifest.vectors['cross-channel']];

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const verifyRaw = (digestHex, sigB64, pubHex) =>
  crypto.verify(null, Buffer.from(digestHex, 'hex'),
    crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' }),
    Buffer.from(sigB64, 'base64'));

let pass = 0, fail = 0, digestChecked = 0;
const digestFor = (contract, input) => (contract === 'TC_V2_TONPROOF_VERIFY_V1' ? tonProofDigest(input) : signDataDigest(input));

// Two independent axes, exactly as the package splits them:
//   (1) DIGEST parity  — recompute the contract digest from the input (when digest_from_input)
//                        and assert byte-identical to the committed digest_sha256_hex. This is
//                        the part Rust must reproduce WITHOUT ed25519.
//   (2) VERDICT        — ed25519_verify(committed digest, signature, pubkey) == expected verdict.
//                        Needs a crypto backend (TS here; Go later). Rust may skip this axis.
for (const rel of all) {
  const v = JSON.parse(fs.readFileSync(path.join(PKG, rel), 'utf8'));
  const stored = v.expect.digest_sha256_hex;
  const errs = [];

  // axis 1 — digest parity
  if (v.digest_from_input) {
    const computed = digestFor(v.contract, v.input).toString('hex');
    digestChecked++;
    if (computed !== stored) errs.push(`DIGEST MISMATCH (computed ${computed.slice(0, 16)}… vs ${stored.slice(0, 16)}…)`);
  }

  // axis 2 — verdict via ed25519 over the committed digest
  const verdict = verifyRaw(stored, v.signature_b64, v.operator_pubkey_hex);
  if (verdict !== v.expect.verdict) errs.push(`verdict ${verdict} (expected ${v.expect.verdict})`);

  if (errs.length === 0) pass++;
  else { fail++; console.log(`❌ ${v.id}: ${errs.join('; ')}`); }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${all.length} vectors pass `
  + `(${manifest.vectors.positive.length} positive, ${manifest.vectors.negative.length} negative, ${manifest.vectors['cross-channel'].length} cross-channel).`);
console.log(`   digest-parity axis exercised on ${digestChecked}/${all.length} vectors (rest are construction-override negatives).`);
if (fail === 0) {
  console.log('   TS reference leg green. Rust target: recompute every digest_from_input digest bit-identically (no ed25519 needed).');
  process.exit(0);
}
process.exit(1);
