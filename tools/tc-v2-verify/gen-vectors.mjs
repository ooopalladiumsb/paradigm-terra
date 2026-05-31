// Generate the TC_V2_SIGNDATA_VERIFY_V1 golden vector package from the PRE-NORMATIVE
// corpus. The TS reference (sign-data.mjs / ton-proof.mjs) is the authority for digests.
//
// Crypto is asserted at generation time: every POSITIVE must verify, every NEGATIVE and
// CROSS-CHANNEL must fail. If any assumption breaks, generation aborts — so a committed
// vector set is one that has already passed its own cryptographic contract.
//
//   node tools/tc-v2-verify/gen-vectors.mjs

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signDataDigest, verifySignData } from './sign-data.mjs';
import { tonProofDigest, verifyTonProof } from './ton-proof.mjs';
import { verifyUnderContract } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'interop/conformance');
const OUT = path.join(ROOT, 'spec/vectors/tc_v2_sig_verify_v1');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const readCap = (rel) => JSON.parse(fs.readFileSync(path.join(CORPUS, rel), 'utf8'));

// ---- load corpus ------------------------------------------------------------
const C = {
  tkBin: readCap('signData/tonkeeper-binary.json'),
  tkTxt: readCap('signData/tonkeeper-text.json'),
  mtwBin: readCap('signData/mytonwallet-binary.json'),
  mtwTxt: readCap('signData/mytonwallet-text.json'),
  proof: readCap('tonProof/mytonwallet-proof.json'),
  tkProof: readCap('tonProof/tonkeeper-proof.json'),
};

const signDataInput = (c) => ({
  workchain: c.workchain,
  address_hash_hex: c.address_hash_hex,
  domain: c.domain,
  timestamp: c.timestamp,
  payload_type: c.payload.type,
  payload_b64: c.payload.type === 'binary' ? c.payload.bytes_b64 : null,
  payload_text: c.payload.type === 'text' ? c.payload.text : null,
});
const tonProofInput = (c) => ({
  workchain: c.workchain,
  address_hash_hex: c.address_hash_hex,
  domain: c.domain,
  timestamp: c.timestamp,
  proof_payload: c.proof_payload,
});

const manifest = { positive: [], negative: [], 'cross-channel': [] };
function write(kind, id, vec) {
  fs.writeFileSync(path.join(OUT, kind, `${id}.json`), JSON.stringify(vec, null, 2) + '\n');
  manifest[kind].push(`${kind}/${id}.json`);
}

// ---- POSITIVE ---------------------------------------------------------------
const positives = [
  { id: 'tonkeeper-binary', cap: C.tkBin, contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: signDataInput(C.tkBin), digest: signDataDigest },
  { id: 'tonkeeper-text', cap: C.tkTxt, contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: signDataInput(C.tkTxt), digest: signDataDigest },
  { id: 'mytonwallet-binary', cap: C.mtwBin, contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: signDataInput(C.mtwBin), digest: signDataDigest },
  { id: 'mytonwallet-text', cap: C.mtwTxt, contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: signDataInput(C.mtwTxt), digest: signDataDigest },
  { id: 'mytonwallet-tonproof', cap: C.proof, contract: 'TC_V2_TONPROOF_VERIFY_V1', input: tonProofInput(C.proof), digest: tonProofDigest },
  { id: 'tonkeeper-tonproof', cap: C.tkProof, contract: 'TC_V2_TONPROOF_VERIFY_V1', input: tonProofInput(C.tkProof), digest: tonProofDigest },
];
for (const p of positives) {
  const r = verifyUnderContract(p.contract, p.input, p.cap.signature_b64, p.cap.operator_pubkey_hex);
  if (!r.ok) throw new Error(`POSITIVE ${p.id} failed to verify — corpus/reference mismatch`);
  write('positive', p.id, {
    id: `positive/${p.id}`, contract: p.contract, channel: p.cap.channel, kind: 'positive',
    description: `Real ${p.cap.wallet.name} ${p.cap.wallet.version} capture; ed25519 verifies against the reconstructed commit.`,
    operator_pubkey_hex: p.cap.operator_pubkey_hex, input: p.input, signature_b64: p.cap.signature_b64,
    digest_from_input: true,
    expect: { digest_sha256_hex: r.digestHex, verdict: true },
    source: p.cap.source,
  });
}

// ---- NEGATIVE (input/signature mutations on a representative signData capture) ----
const baseCap = C.mtwBin, baseInput = signDataInput(C.mtwBin);
const flipByte0 = (b64) => { const s = Buffer.from(b64, 'base64'); s[0] ^= 0x01; return s.toString('base64'); };

const negatives = [
  { id: 'signature-bit-flip', mutation: 'signature byte[0] ^= 0x01',
    contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: baseInput, sig: flipByte0(baseCap.signature_b64), pub: baseCap.operator_pubkey_hex },
  { id: 'timestamp-plus-one', mutation: 'timestamp + 1',
    contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: { ...baseInput, timestamp: baseInput.timestamp + 1 }, sig: baseCap.signature_b64, pub: baseCap.operator_pubkey_hex },
  { id: 'timestamp-minus-one', mutation: 'timestamp - 1',
    contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: { ...baseInput, timestamp: baseInput.timestamp - 1 }, sig: baseCap.signature_b64, pub: baseCap.operator_pubkey_hex },
  { id: 'wrong-domain', mutation: 'domain -> evil.example.com',
    contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: { ...baseInput, domain: 'evil.example.com' }, sig: baseCap.signature_b64, pub: baseCap.operator_pubkey_hex },
  { id: 'wrong-pubkey', mutation: "operator_pubkey -> Tonkeeper's key",
    contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: baseInput, sig: baseCap.signature_b64, pub: C.tkBin.operator_pubkey_hex },
  { id: 'wrong-payload', mutation: 'payload bytes tampered (byte[0] ^= 0x01)',
    contract: 'TC_V2_SIGNDATA_VERIFY_V1', input: { ...baseInput, payload_b64: flipByte0(baseInput.payload_b64) }, sig: baseCap.signature_b64, pub: baseCap.operator_pubkey_hex },
  // wrong discriminator: identical payload BYTES (decoded binary is ASCII), but type tag "bin" -> "txt"
  { id: 'wrong-discriminator', mutation: 'type tag bin->txt with byte-identical payload',
    contract: 'TC_V2_SIGNDATA_VERIFY_V1',
    input: { ...baseInput, payload_type: 'text', payload_b64: null, payload_text: Buffer.from(baseInput.payload_b64, 'base64').toString('utf8') },
    sig: baseCap.signature_b64, pub: baseCap.operator_pubkey_hex },
];
for (const n of negatives) {
  const r = verifyUnderContract(n.contract, n.input, n.sig, n.pub);
  if (r.ok) throw new Error(`NEGATIVE ${n.id} unexpectedly VERIFIED — test has no teeth`);
  write('negative', n.id, {
    id: `negative/${n.id}`, contract: n.contract, channel: 'signData', kind: 'negative', mutation: n.mutation,
    description: `Mutated copy of ${baseCap.capture_id}; ${n.mutation}. MUST fail.`,
    operator_pubkey_hex: n.pub, input: n.input, signature_b64: n.sig,
    digest_from_input: true,
    expect: { digest_sha256_hex: r.digestHex, verdict: false },
    source: baseCap.source,
  });
}

// wrong-hash-layer: an extra sha256 over the correct signData digest (one too many layers).
// Realized via an explicit signed-digest override so the reference module stays clean.
{
  const override = sha256(signDataDigest(baseInput)).toString('hex');
  const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(baseCap.operator_pubkey_hex, 'hex')]), format: 'der', type: 'spki' });
  const ok = crypto.verify(null, Buffer.from(override, 'hex'), key, Buffer.from(baseCap.signature_b64, 'base64'));
  if (ok) throw new Error('NEGATIVE wrong-hash-layer unexpectedly VERIFIED');
  write('negative', 'wrong-hash-layer', {
    id: 'negative/wrong-hash-layer', contract: 'TC_V2_SIGNDATA_VERIFY_V1', channel: 'signData', kind: 'negative',
    mutation: 'ed25519 fed sha256(signDataDigest) — one extra hash layer',
    description: 'Tests that the SINGLE-sha256 envelope is required; an extra layer must fail. digest_from_input=false: the signed digest is an external (wrong) construction, NOT derivable from the contract over the input — so digest-parity impls do not recompute it.',
    operator_pubkey_hex: baseCap.operator_pubkey_hex, input: baseInput, signature_b64: baseCap.signature_b64,
    digest_from_input: false,
    expect: { digest_sha256_hex: override, verdict: false },
    source: baseCap.source,
  });
}

// ---- CROSS-CHANNEL (the critical integrator-safety vectors) -----------------
// Same (pubkey, signature) routed through the WRONG contract -> different commit -> MUST fail.
{
  // signData binary capture, verified under the ton_proof contract
  const input = { ...tonProofInput(C.mtwBin), proof_payload: C.mtwBin.payload.bytes_b64 };
  const r = verifyUnderContract('TC_V2_TONPROOF_VERIFY_V1', input, C.mtwBin.signature_b64, C.mtwBin.operator_pubkey_hex);
  if (r.ok) throw new Error('CROSS-CHANNEL signData->tonProof unexpectedly VERIFIED');
  write('cross-channel', 'signdata-under-tonproof-verifier', {
    id: 'cross-channel/signdata-under-tonproof-verifier', contract: 'TC_V2_TONPROOF_VERIFY_V1', channel: 'signData', kind: 'cross-channel',
    description: 'A genuine signData capture (real sig) verified with the ton_proof routine. MUST fail — proves the two routines are NOT interchangeable (different endianness + nested vs single hash).',
    operator_pubkey_hex: C.mtwBin.operator_pubkey_hex, input, signature_b64: C.mtwBin.signature_b64,
    digest_from_input: true,
    expect: { digest_sha256_hex: r.digestHex, verdict: false },
    source: C.mtwBin.source,
  });
}
{
  // ton_proof capture, verified under the signData contract
  const input = { ...signDataInput({ ...C.proof, payload: { type: 'text', text: C.proof.proof_payload } }) };
  const r = verifyUnderContract('TC_V2_SIGNDATA_VERIFY_V1', input, C.proof.signature_b64, C.proof.operator_pubkey_hex);
  if (r.ok) throw new Error('CROSS-CHANNEL tonProof->signData unexpectedly VERIFIED');
  write('cross-channel', 'tonproof-under-signdata-verifier', {
    id: 'cross-channel/tonproof-under-signdata-verifier', contract: 'TC_V2_SIGNDATA_VERIFY_V1', channel: 'tonProof', kind: 'cross-channel',
    description: 'A genuine ton_proof capture (real sig) verified with the signData routine. MUST fail — same non-interchangeability in the other direction.',
    operator_pubkey_hex: C.proof.operator_pubkey_hex, input, signature_b64: C.proof.signature_b64,
    digest_from_input: true,
    expect: { digest_sha256_hex: r.digestHex, verdict: false },
    source: C.proof.source,
  });
}

// ---- manifest ---------------------------------------------------------------
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  package: 'TC_V2_SIGNDATA_VERIFY_V1',
  version: '0.1.0',
  status: 'PRE-NORMATIVE',
  description: 'Golden conformance vectors for the two TC v2 owner-signature contracts. Promotion to NORMATIVE is gated on TS/Rust/Go cross-language parity (see docs/draft/tc-v2-sig-verify-v1-draft.md).',
  contracts: {
    TC_V2_SIGNDATA_VERIFY_V1: 'Contract A — owner signature (signData); BE; txt/bin discriminator; single sha256.',
    TC_V2_TONPROOF_VERIFY_V1: 'Contract B — owner authentication (ton-proof-item-v2); LE; nested sha256.',
  },
  reference_impl: 'tools/tc-v2-verify/ (TypeScript/JS)',
  corpus: 'interop/conformance/',
  counts: { positive: manifest.positive.length, negative: manifest.negative.length, 'cross-channel': manifest['cross-channel'].length },
  vectors: manifest,
}, null, 2) + '\n');

console.log(`✅ generated ${manifest.positive.length} positive, ${manifest.negative.length} negative, ${manifest['cross-channel'].length} cross-channel vectors into ${path.relative(ROOT, OUT)}`);
console.log('   all crypto assertions passed at generation time.');
