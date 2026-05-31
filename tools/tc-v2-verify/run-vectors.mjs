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
import { verifyUnderContract } from './index.mjs';

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

let pass = 0, fail = 0;
const digestFor = (contract, input) => (contract === 'TC_V2_TONPROOF_VERIFY_V1' ? tonProofDigest(input) : signDataDigest(input));

for (const rel of all) {
  const v = JSON.parse(fs.readFileSync(path.join(PKG, rel), 'utf8'));
  let ok;
  if (v.signed_digest_override_hex) {
    // construction-level negative: verify the signature against the explicitly-wrong digest bytes
    ok = verifyRaw(v.signed_digest_override_hex, v.signature_b64, v.operator_pubkey_hex);
  } else {
    ok = verifyUnderContract(v.contract, v.input, v.signature_b64, v.operator_pubkey_hex).ok;
  }

  const verdictOk = ok === v.expect.verify;
  // digest parity check (positives carry the anchored digest)
  let digestOk = true;
  if (v.expect.digest_sha256_hex) {
    digestOk = digestFor(v.contract, v.input).toString('hex') === v.expect.digest_sha256_hex;
  }

  if (verdictOk && digestOk) { pass++; }
  else {
    fail++;
    console.log(`❌ ${v.id}: verdict ${ok} (expected ${v.expect.verify})${digestOk ? '' : ', DIGEST MISMATCH'}`);
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${all.length} vectors pass `
  + `(${manifest.vectors.positive.length} positive, ${manifest.vectors.negative.length} negative, ${manifest.vectors['cross-channel'].length} cross-channel).`);
if (fail === 0) {
  console.log('   TS reference leg green. Parity target for Rust/Go: reproduce every digest_sha256_hex bit-identically.');
  process.exit(0);
}
process.exit(1);
