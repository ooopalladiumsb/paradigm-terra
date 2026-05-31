#!/usr/bin/env node
// Verify a single ton_proof capture file against Contract B (TC_V2_TONPROOF_VERIFY_V1),
// using the same reference verifier as the golden vectors. Use this to confirm a freshly
// captured ton_proof is VALID before adding it to interop/conformance/.
//
//   node interop/verify-tonproof-capture.mjs <capture.json>
//
// Expected capture schema (same as interop/conformance/tonProof/*.json):
//   { operator_pubkey_hex, address_hash_hex, workchain, domain, timestamp,
//     proof_payload, signature_b64 }
//
// PASS means: ed25519_verify( ton-proof-item-v2 commit, signature, pubkey ) == true,
// i.e. this wallet produced the same Contract B commit as MyTonWallet → a valid 2nd capture.

import fs from 'node:fs';
import { verifyTonProof } from '../tools/tc-v2-verify/ton-proof.mjs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node interop/verify-tonproof-capture.mjs <capture.json>');
  process.exit(2);
}
const c = JSON.parse(fs.readFileSync(path, 'utf8'));

const required = ['operator_pubkey_hex', 'address_hash_hex', 'workchain', 'domain', 'timestamp', 'proof_payload', 'signature_b64'];
const missing = required.filter((k) => c[k] === undefined || c[k] === null || c[k] === '');
if (missing.length) {
  console.error(`❌ capture is missing required field(s): ${missing.join(', ')}`);
  console.error('   (the 2026-05-30 Tonkeeper session failed exactly here — signature/pubkey were not recorded)');
  process.exit(1);
}

const pub = Buffer.from(c.operator_pubkey_hex, 'hex');
const sig = Buffer.from(c.signature_b64, 'base64');
console.log(`pubkey ${pub.length} bytes, signature ${sig.length} bytes, domain "${c.domain}" (${Buffer.from(c.domain, 'utf8').length} bytes), ts ${c.timestamp}`);
if (pub.length !== 32) { console.error('❌ operator_pubkey_hex is not 32 bytes'); process.exit(1); }
if (sig.length !== 64) { console.error('❌ signature_b64 is not a 64-byte Ed25519 signature'); process.exit(1); }

const ok = verifyTonProof(
  { workchain: c.workchain, address_hash_hex: c.address_hash_hex, domain: c.domain, timestamp: c.timestamp, proof_payload: c.proof_payload },
  c.signature_b64,
  c.operator_pubkey_hex,
);

if (ok) {
  console.log(`✅ PASS — ${c.capture_id ?? path}: ton_proof verifies against Contract B. Valid 2nd-wallet capture.`);
  process.exit(0);
}
console.log('❌ FAIL — ed25519_verify did not pass. Common causes:');
console.log('   • proof_payload must be the LITERAL base64 nonce string the dApp sent (not decoded)');
console.log('   • operator_pubkey_hex must be the wallet account public key (account.publicKey), raw 32-byte hex');
console.log('   • domain must be the exact origin the wallet signed (e.g. ooopalladiumsb.github.io), no scheme/port');
console.log('   • timestamp must be the proof.timestamp echoed by the wallet (unix seconds)');
process.exit(1);
