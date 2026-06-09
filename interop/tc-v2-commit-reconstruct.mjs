#!/usr/bin/env node
// Gate #1 — TON Connect v2 signData commit reconstruction.
//
// Goal: recover the EXACT byte layout the wallet signs for signData/{text,binary},
// proven by ed25519_verify passing against real captures from TWO independent TC v2
// wallets (Tonkeeper 4.7.0, MyTonWallet 4.10.1). A layout is accepted only if it
// verifies ALL captures — a single wallet could pass a wrong guess by luck; four
// independent (pubkey, message, sig) triples cannot.
//
// Captures sourced verbatim from:
//   interop/observations/2026-05-30-tonkeeper.md   (Phase 4a binary, Phase 5 text)
//   interop/observations/2026-05-31-mytonwallet.md (Phase 4a binary, Phase 5 text)
//
// No spec recollection is trusted: the layout is brute-forced over a small space of
// documented TC-v2 variants and confirmed by cryptographic verification.

import crypto from 'node:crypto';

// ---- raw capture corpus -----------------------------------------------------
const CAPTURES = [
  {
    label: 'tonkeeper-4.7.0 / binary',
    pubkeyHex: 'e4bd70ac7328e5cb46b79227ca972a421ff5261e1a0068ca16cd8e7c8768c48a',
    addrHashHex: '28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8',
    workchain: 0,
    type: 'binary',
    payloadB64: 'WyJhZ2VudGljX2NhbmNlbF9yb290X3dhbGxldF9zZXR1cCJd',
    domain: '10076c73b909ca.lhr.life',
    timestamp: 1780128533,
    sigB64: 'cRTFbHRLOkfKOnd66XpBMa5j2ZOK6/etlgy+WJz8PDL4ddhXtFNQjDE6LahkhIE4nfd924FNEBxaiBaWfHsaDA==',
  },
  {
    label: 'tonkeeper-4.7.0 / text',
    pubkeyHex: 'e4bd70ac7328e5cb46b79227ca972a421ff5261e1a0068ca16cd8e7c8768c48a',
    addrHashHex: '28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8',
    workchain: 0,
    type: 'text',
    text: 'WyJhZ2VudGljX2NhbmNlbF9yb290X3dhbGxldF9zZXR1cCJd',
    domain: '10076c73b909ca.lhr.life',
    timestamp: 1780128676,
    sigB64: '8yeuVrxkkTp/XzNr2voynl6qJhIdEkPiPSwyO4q46q+QfJFbvceutfgGvhVv7OBRHc+w5KdXYRCi7gsbRlAdBg==',
  },
  {
    label: 'mytonwallet-4.10.1 / binary',
    pubkeyHex: '330eba04a55777e3e14d4080092e5d31540b924b23d8d5a7c025be097cce5411',
    addrHashHex: 'fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268',
    workchain: 0,
    type: 'binary',
    payloadB64: 'aW50ZXJvcC1vYnNlcnZhdGlvbi1zYW1wbGU=',
    domain: 'ooopalladiumsb.github.io',
    timestamp: 1780210455,
    sigB64: 'F31Se0AAztZR3JkbWYwxUvbNKTsDdf3ZbyhGo3IzL2t9kxkpV/Q1WzTJO+ciiSHrT9SL9hjI8Ym9fdKQldQmDw==',
  },
  {
    label: 'mytonwallet-4.10.1 / text',
    pubkeyHex: '330eba04a55777e3e14d4080092e5d31540b924b23d8d5a7c025be097cce5411',
    addrHashHex: 'fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268',
    workchain: 0,
    type: 'text',
    text: 'aW50ZXJvcC1vYnNlcnZhdGlvbi1zYW1wbGU=',
    domain: 'ooopalladiumsb.github.io',
    timestamp: 1780210616,
    sigB64: 'DZ8d/yfc0DolG3TLacRs/zEb8vbc7PM5KGE36X93YSxfTA2y5fe0Z5A2yjaBJFntwlXiJbtsdvJm94OBk+GxBA==',
  },
];

// ---- helpers ----------------------------------------------------------------
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function rawPubToKey(hex) {
  const der = Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}
function ed25519Verify(message, sig, keyObj) {
  // Node verifies ed25519 with algorithm=null; `message` is the raw signed bytes.
  return crypto.verify(null, message, keyObj, sig);
}
const enc = (s) => Buffer.from(s, 'utf8');

function payloadContent(cap) {
  return cap.type === 'text'
    ? enc(cap.text)                       // text signed as opaque UTF-8
    : Buffer.from(cap.payloadB64, 'base64'); // binary: base64-decoded raw bytes
}

// ---- layout builder ---------------------------------------------------------
// Each candidate is a recipe producing the byte string fed to ed25519.
function buildMessage(cap, opt) {
  const parts = [];
  if (opt.ffffPrefix) parts.push(Buffer.from([0xff, 0xff]));
  if (opt.schemaPrefix) parts.push(enc(opt.schemaPrefix));

  // workchain
  if (opt.workchain) {
    const wc = Buffer.alloc(4);
    if (opt.wcEndian === 'be') wc.writeInt32BE(cap.workchain);
    else wc.writeInt32LE(cap.workchain);
    parts.push(wc);
  }

  if (opt.addrHash) parts.push(Buffer.from(cap.addrHashHex, 'hex'));

  // domain
  const domainBuf = enc(cap.domain);
  if (opt.domainLen === 'u32be') { const b = Buffer.alloc(4); b.writeUInt32BE(domainBuf.length); parts.push(b); }
  else if (opt.domainLen === 'u32le') { const b = Buffer.alloc(4); b.writeUInt32LE(domainBuf.length); parts.push(b); }
  else if (opt.domainLen === 'u8') { parts.push(Buffer.from([domainBuf.length])); }
  parts.push(domainBuf);

  // timestamp
  const ts = cap.timestamp;
  if (opt.ts === 'u64be') { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ts)); parts.push(b); }
  else if (opt.ts === 'u64le') { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(ts)); parts.push(b); }
  else if (opt.ts === 'u32be') { const b = Buffer.alloc(4); b.writeUInt32BE(ts); parts.push(b); }
  else if (opt.ts === 'u32le') { const b = Buffer.alloc(4); b.writeUInt32LE(ts); parts.push(b); }

  // per-type 3-byte prefix ("txt"/"bin") — sits between timestamp and payload
  if (opt.typePrefix) parts.push(enc(cap.type === 'text' ? 'txt' : 'bin'));

  // payload (optionally length-prefixed)
  const content = payloadContent(cap);
  if (opt.payloadLen === 'u32be') { const b = Buffer.alloc(4); b.writeUInt32BE(content.length); parts.push(b); }
  else if (opt.payloadLen === 'u32le') { const b = Buffer.alloc(4); b.writeUInt32LE(content.length); parts.push(b); }
  parts.push(content);

  let message = Buffer.concat(parts);
  if (opt.finalSha256) message = crypto.createHash('sha256').update(message).digest();
  return message;
}

// ---- search space -----------------------------------------------------------
const SCHEMA_PREFIXES = [
  'ton-connect/sign-data/',
  '\x10ton-connect/sign-data/',
  'ton-connect/sign-data-v2/',
  '',
];
const opts = {
  ffffPrefix: [true, false],
  schemaPrefix: SCHEMA_PREFIXES,
  workchain: [true, false],
  wcEndian: ['be', 'le'],
  addrHash: [true, false],
  domainLen: ['u32be', 'u32le', 'u8', 'none'],
  ts: ['u64be', 'u64le', 'u32be', 'u32le'],
  typePrefix: [true, false],
  payloadLen: ['u32be', 'u32le', 'none'],
  finalSha256: [true, false],
};

function* product(o) {
  const keys = Object.keys(o);
  const idx = keys.map(() => 0);
  while (true) {
    yield Object.fromEntries(keys.map((k, i) => [k, o[k][idx[i]]]));
    let p = keys.length - 1;
    while (p >= 0) {
      idx[p]++;
      if (idx[p] < o[keys[p]].length) break;
      idx[p] = 0; p--;
    }
    if (p < 0) break;
  }
}

// ---- run --------------------------------------------------------------------
const keyObjs = CAPTURES.map((c) => rawPubToKey(c.pubkeyHex));
const sigs = CAPTURES.map((c) => Buffer.from(c.sigB64, 'base64'));

// sanity: signatures are 64 bytes, keys load
CAPTURES.forEach((c, i) => {
  if (sigs[i].length !== 64) throw new Error(`${c.label}: sig not 64 bytes (${sigs[i].length})`);
});

let tried = 0;
const winners = [];
for (const opt of product(opts)) {
  tried++;
  let allPass = true;
  for (let i = 0; i < CAPTURES.length; i++) {
    const msg = buildMessage(CAPTURES[i], opt);
    if (!ed25519Verify(msg, sigs[i], keyObjs[i])) { allPass = false; break; }
  }
  if (allPass) winners.push(opt);
}

console.log(`Tried ${tried} candidate layouts against ${CAPTURES.length} captures.\n`);
if (winners.length === 0) {
  console.log('❌ No layout in the search space verifies all captures.');
  // Diagnostic: how far does the canonical-looking guess get?
  const guess = {
    ffffPrefix: true, schemaPrefix: 'ton-connect/sign-data/', workchain: true,
    wcEndian: 'be', addrHash: true, domainLen: 'u32be', ts: 'u64be',
    payloadLen: 'u32be', finalSha256: true,
  };
  console.log('\nPer-capture result for the documented-canonical guess:');
  CAPTURES.forEach((c, i) => {
    const ok = ed25519Verify(buildMessage(c, guess), sigs[i], keyObjs[i]);
    console.log(`  ${ok ? '✅' : '❌'} ${c.label}`);
  });
  process.exit(1);
}

console.log(`✅ ${winners.length} layout(s) verify ALL captures:\n`);
for (const w of winners) {
  console.log(JSON.stringify(w));
}
if (winners.length > 1) {
  const fields = Object.keys(winners[0]).filter((k) => new Set(winners.map((w) => w[k])).size > 1);
  console.log(`\n(note: winners differ ONLY in {${fields.join(', ')}} — unconstrained by this`
    + ` corpus. All captures are workchain 0, so int32 BE/LE of the workchain field are the`
    + ` identical 0x00000000; the reference impl uses BE, which the canonical verifier pins.)`);
}
// Emit a human-readable layout description for the winner(s).
for (const w of winners) {
  console.log('\n--- byte layout ---');
  const seg = [];
  if (w.ffffPrefix) seg.push('0xFFFF');
  if (w.schemaPrefix) seg.push(`utf8(${JSON.stringify(w.schemaPrefix)})`);
  if (w.workchain) seg.push(`workchain(int32 ${w.wcEndian})`);
  if (w.addrHash) seg.push('address_hash(32)');
  if (w.domainLen !== 'none') seg.push(`domain_len(${w.domainLen})`);
  seg.push('utf8(domain)');
  seg.push(`timestamp(${w.ts})`);
  if (w.typePrefix) seg.push('type_prefix("txt"|"bin")');
  if (w.payloadLen !== 'none') seg.push(`payload_len(${w.payloadLen})`);
  seg.push('payload_bytes');
  let m = seg.join(' ‖ ');
  m = w.finalSha256 ? `ed25519_verify( sha256( ${m} ) )` : `ed25519_verify( ${m} )`;
  console.log(m);
}

// -----------------------------------------------------------------------------
// Canonical, parameter-free verifier for the confirmed TC v2 signData layout.
// This is the artifact: no search, no options — the exact bytes a TC v2 wallet
// signs for {text,binary}, with ed25519 verification over sha256(message).
//
//   message = 0xFFFF ‖ "ton-connect/sign-data/"
//           ‖ int32_be(workchain) ‖ address_hash(32)
//           ‖ uint32_be(domain_len) ‖ utf8(domain)
//           ‖ uint64_be(timestamp)
//           ‖ ("txt"|"bin") ‖ uint32_be(payload_len) ‖ payload
//   verify  = ed25519_verify( sha256(message), signature, pubkey )
// -----------------------------------------------------------------------------
function tcV2SignDataCommit(cap) {
  const enc2 = (s) => Buffer.from(s, 'utf8');
  const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const i32be = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
  const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };

  const domainBuf = enc2(cap.domain);
  const content = cap.type === 'text'
    ? enc2(cap.text)
    : Buffer.from(cap.payloadB64, 'base64');
  const typePrefix = cap.type === 'text' ? 'txt' : 'bin';

  const message = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    enc2('ton-connect/sign-data/'),
    i32be(cap.workchain),
    Buffer.from(cap.addrHashHex, 'hex'),
    u32be(domainBuf.length),
    domainBuf,
    u64be(cap.timestamp),
    enc2(typePrefix),
    u32be(content.length),
    content,
  ]);
  return crypto.createHash('sha256').update(message).digest();
}

function verifyTcV2SignData(cap) {
  return ed25519Verify(
    tcV2SignDataCommit(cap),
    Buffer.from(cap.sigB64, 'base64'),
    rawPubToKey(cap.pubkeyHex),
  );
}

console.log('\n=== canonical verifier — independent confirmation ===');
let allOk = true;
for (const cap of CAPTURES) {
  const ok = verifyTcV2SignData(cap);
  allOk &&= ok;
  console.log(`  ${ok ? '✅' : '❌'} ${cap.label}`);
}

// Negative controls — prove the test has teeth (must FAIL).
console.log('\n=== negative controls (must reject) ===');
const ctrl = [
  // flipped byte in signature
  { name: 'corrupted signature', cap: { ...CAPTURES[0], sigB64: Buffer.from(
      (() => { const s = Buffer.from(CAPTURES[0].sigB64, 'base64'); s[0] ^= 0x01; return s; })()
    ).toString('base64') } },
  // wrong timestamp (off by one)
  { name: 'timestamp off-by-one', cap: { ...CAPTURES[0], timestamp: CAPTURES[0].timestamp + 1 } },
  // wrong domain
  { name: 'domain mismatch', cap: { ...CAPTURES[0], domain: 'evil.example.com' } },
  // cross-wallet pubkey (MTW key against TK capture)
  { name: 'wrong pubkey', cap: { ...CAPTURES[0], pubkeyHex: CAPTURES[2].pubkeyHex } },
];
let negOk = true;
for (const c of ctrl) {
  const rejected = !verifyTcV2SignData(c.cap);
  negOk &&= rejected;
  console.log(`  ${rejected ? '✅ rejected' : '❌ ACCEPTED'} — ${c.name}`);
}

console.log('');
if (allOk && negOk) {
  console.log('✅ GATE #1 PASS — TC v2 signData commit reconstructed; ed25519_verify holds on '
    + `${CAPTURES.length}/${CAPTURES.length} real captures (2 wallets) and rejects all negative controls.`);
  process.exit(0);
} else {
  console.log('❌ GATE #1 FAIL — canonical verifier did not behave as required.');
  process.exit(1);
}
