#!/usr/bin/env node
// Companion to tc-v2-commit-reconstruct.mjs — the SECOND TC v2 crypto channel.
//
// Reconstructs the ton-proof-item-v2 signed message and confirms it by ed25519_verify
// against a real captured `ton_proof` from MyTonWallet 4.10.1 (matrix §3 / observation
// 2026-05-31). This is the channel PFC-1 §10.2 relies on to bind operator_pubkey.
//
// Cryptographic note: ed25519_verify(M, sig, pubkey) passes only if M is byte-identical
// to the message the wallet actually signed. So a SINGLE capture pins the layout among
// candidates — any wrong layout fails with overwhelming probability. The only fields this
// corpus cannot constrain are those that are degenerate in it (workchain = 0 ⇒ int32 BE/LE
// both 0x00000000). Unlike signData, ton_proof's domain_len and timestamp are non-zero, so
// THEIR endianness IS pinned empirically here.
//
// Capture source: interop/observations/2026-05-31-mytonwallet.md, Phase 3.

import crypto from 'node:crypto';

// ---- the single ton_proof capture -------------------------------------------
const CAP = {
  label: 'mytonwallet-4.10.1 / ton_proof',
  pubkeyHex: '330eba04a55777e3e14d4080092e5d31540b924b23d8d5a7c025be097cce5411',
  addrHashHex: 'fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268',
  workchain: 0,
  domain: 'ooopalladiumsb.github.io',          // lengthBytes 24 (ASCII)
  timestamp: 1780211353,
  payloadB64: 'botvmjojzz/bIb2NCGASOzY6xxr/uQFOG9459WVUJmc=', // dApp nonce, echoed verbatim
  sigB64: 'RrL/RA76ks6UYMKv0ZpxDiiiLj11FnGq16ecX4loCrKjJSnd1pUQMLacJ2PYYXyT3IMOJ911AtDmmA4rketTBw==',
};

// ---- helpers ----------------------------------------------------------------
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const rawPubToKey = (hex) =>
  crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
const ed25519Verify = (msg, sig, key) => crypto.verify(null, msg, key, sig);
const enc = (s) => Buffer.from(s, 'utf8');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

// ---- inner message builder --------------------------------------------------
function buildInner(cap, opt) {
  const parts = [enc(opt.proofPrefix)];

  if (opt.workchain) {
    const wc = Buffer.alloc(4);
    if (opt.wcEndian === 'be') wc.writeInt32BE(cap.workchain); else wc.writeInt32LE(cap.workchain);
    parts.push(wc);
  }
  parts.push(Buffer.from(cap.addrHashHex, 'hex'));

  const domainBuf = enc(cap.domain);
  if (opt.domainLen === 'u32le') { const b = Buffer.alloc(4); b.writeUInt32LE(domainBuf.length); parts.push(b); }
  else if (opt.domainLen === 'u32be') { const b = Buffer.alloc(4); b.writeUInt32BE(domainBuf.length); parts.push(b); }
  else if (opt.domainLen === 'u8') { parts.push(Buffer.from([domainBuf.length])); }
  parts.push(domainBuf);

  const ts = cap.timestamp;
  if (opt.ts === 'u64le') { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(ts)); parts.push(b); }
  else if (opt.ts === 'u64be') { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ts)); parts.push(b); }
  else if (opt.ts === 'u32le') { const b = Buffer.alloc(4); b.writeUInt32LE(ts); parts.push(b); }
  else if (opt.ts === 'u32be') { const b = Buffer.alloc(4); b.writeUInt32BE(ts); parts.push(b); }

  // payload: the proof nonce — either the literal base64 string bytes, or decoded raw bytes
  const payload = opt.payloadDecoded ? Buffer.from(cap.payloadB64, 'base64') : enc(cap.payloadB64);
  parts.push(payload);

  return Buffer.concat(parts);
}

// what actually gets fed to ed25519
function buildSigned(cap, opt) {
  const inner = buildInner(cap, opt);
  if (opt.outer === 'tc-double') return sha256(Buffer.concat([Buffer.from([0xff, 0xff]), enc('ton-connect'), sha256(inner)]));
  if (opt.outer === 'sha256') return sha256(inner);
  return inner; // 'raw'
}

// ---- search space -----------------------------------------------------------
const opts = {
  proofPrefix: ['ton-proof-item-v2/', 'ton-proof-item-v2', 'ton-connect/proof-item-v2/'],
  workchain: [true, false],
  wcEndian: ['be', 'le'],
  domainLen: ['u32le', 'u32be', 'u8', 'none'],
  ts: ['u64le', 'u64be', 'u32le', 'u32be'],
  payloadDecoded: [false, true],
  outer: ['tc-double', 'sha256', 'raw'],
};
function* product(o) {
  const keys = Object.keys(o); const idx = keys.map(() => 0);
  while (true) {
    yield Object.fromEntries(keys.map((k, i) => [k, o[k][idx[i]]]));
    let p = keys.length - 1;
    while (p >= 0) { idx[p]++; if (idx[p] < o[keys[p]].length) break; idx[p] = 0; p--; }
    if (p < 0) break;
  }
}

// ---- run --------------------------------------------------------------------
const key = rawPubToKey(CAP.pubkeyHex);
const sig = Buffer.from(CAP.sigB64, 'base64');
if (sig.length !== 64) throw new Error(`sig not 64 bytes (${sig.length})`);

let tried = 0; const winners = [];
for (const opt of product(opts)) {
  tried++;
  if (ed25519Verify(buildSigned(CAP, opt), sig, key)) winners.push(opt);
}
console.log(`Tried ${tried} candidate layouts against 1 ton_proof capture.\n`);

if (winners.length === 0) {
  console.log('❌ No ton-proof-item-v2 layout in the search space verifies the capture.');
  process.exit(1);
}

console.log(`✅ ${winners.length} layout(s) verify the capture:\n`);
for (const w of winners) console.log(JSON.stringify(w));
const varying = Object.keys(winners[0]).filter((k) => new Set(winners.map((w) => w[k])).size > 1);
if (varying.length) {
  console.log(`\n(note: winners differ ONLY in {${varying.join(', ')}} — unconstrained by this`
    + ` capture. workchain is 0, so its int32 BE/LE are the identical 0x00000000. domain_len`
    + ` and timestamp endianness ARE pinned, since both are non-zero here.)`);
}

const w0 = winners[0];
console.log('\n--- ton-proof-item-v2 byte layout (empirically confirmed) ---');
const innerSeg = [
  `utf8(${JSON.stringify(w0.proofPrefix)})`,
  w0.workchain ? `workchain(int32 ${w0.wcEndian})` : null,
  'address_hash(32)',
  w0.domainLen !== 'none' ? `domain_len(${w0.domainLen})` : null,
  'utf8(domain)',
  `timestamp(${w0.ts})`,
  w0.payloadDecoded ? 'payload(base64-decoded bytes)' : 'payload(literal nonce-string bytes)',
].filter(Boolean).join(' ‖ ');
const inner = `inner = ${innerSeg}`;
let signed;
if (w0.outer === 'tc-double') signed = `ed25519_verify( sha256( 0xFFFF ‖ "ton-connect" ‖ sha256(inner) ) )`;
else if (w0.outer === 'sha256') signed = `ed25519_verify( sha256(inner) )`;
else signed = `ed25519_verify( inner )`;
console.log(inner + '\n' + signed);

// ---- canonical parameter-free verifier + negative controls ------------------
function verifyTonProof(cap) {
  const domainBuf = enc(cap.domain);
  const dlen = Buffer.alloc(4); dlen.writeUInt32LE(domainBuf.length);
  const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(cap.timestamp));
  const inner = Buffer.concat([
    enc('ton-proof-item-v2/'),
    (() => { const b = Buffer.alloc(4); b.writeInt32BE(cap.workchain); return b; })(),
    Buffer.from(cap.addrHashHex, 'hex'),
    dlen, domainBuf, ts,
    enc(cap.payloadB64), // literal nonce string bytes
  ]);
  const signed = sha256(Buffer.concat([Buffer.from([0xff, 0xff]), enc('ton-connect'), sha256(inner)]));
  return ed25519Verify(signed, Buffer.from(cap.sigB64, 'base64'), rawPubToKey(cap.pubkeyHex));
}

console.log('\n=== canonical verifier — independent confirmation ===');
const ok = verifyTonProof(CAP);
console.log(`  ${ok ? '✅' : '❌'} ${CAP.label}`);

console.log('\n=== negative controls (must reject) ===');
const flippedSig = (() => { const s = Buffer.from(CAP.sigB64, 'base64'); s[5] ^= 0x01; return s.toString('base64'); })();
const ctrl = [
  { name: 'corrupted signature', cap: { ...CAP, sigB64: flippedSig } },
  { name: 'timestamp off-by-one', cap: { ...CAP, timestamp: CAP.timestamp + 1 } },
  { name: 'domain mismatch', cap: { ...CAP, domain: 'evil.example.com' } },
  { name: 'payload (nonce) tampered', cap: { ...CAP, payloadB64: 'AAAAmjojzz/bIb2NCGASOzY6xxr/uQFOG9459WVUJmc=' } },
];
let negOk = true;
for (const c of ctrl) { const rej = !verifyTonProof(c.cap); negOk &&= rej; console.log(`  ${rej ? '✅ rejected' : '❌ ACCEPTED'} — ${c.name}`); }

console.log('');
if (ok && negOk) {
  console.log('✅ ton_proof PASS — ton-proof-item-v2 commit reconstructed; ed25519_verify holds on the '
    + 'real capture and rejects all negative controls. Second TC v2 crypto channel confirmed.');
  process.exit(0);
} else {
  console.log('❌ ton_proof FAIL.');
  process.exit(1);
}
