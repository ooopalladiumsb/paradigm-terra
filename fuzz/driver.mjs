// Differential fuzzer for the three @paradigm-terra/canonical implementations
// (TypeScript reference, Rust parity, Go parity).
//
// Generates random test cases across every canonical primitive, feeds the
// identical batch to all three language harnesses, and flags any case where the
// three do not agree on BOTH accept/reject AND output bytes. The Unicode space
// is sampled aggressively because the three NFC backends are independent
// (Node ICU / Rust unicode-normalization / Go x/text) and are the most likely
// place for a real conformance divergence.
//
// Usage:
//   node fuzz/driver.mjs [--cases N] [--seed S] [--op OP] [--no-min] [--show K]
//
// Exit code 0 = all agree, 1 = divergence(s) found, 2 = harness/protocol error.

import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const HARNESSES = {
  ts: { cmd: "node", args: [resolve(HERE, "ts_harness.mjs")] },
  go: { cmd: resolve(HERE, "bin", "go_harness"), args: [] },
  rs: {
    cmd: resolve(ROOT, "canonical-rs/target/x86_64-unknown-linux-musl/debug/fuzz_harness"),
    args: [],
  },
};

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const N = Number.parseInt(getArg("--cases", "20000"), 10);
const SEED = Number.parseInt(getArg("--seed", String((Date.now() >>> 0))), 10);
const ONLY_OP = getArg("--op", null);
const DO_MIN = !argv.includes("--no-min");
const SHOW = Number.parseInt(getArg("--show", "12"), 10);

// ---------------------------------------------------------------------------
// PRNG (deterministic, seedable)
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(SEED);
const ri = (n) => Math.floor(rng() * n);
const pick = (arr) => arr[ri(arr.length)];
const chance = (p) => rng() < p;

// ---------------------------------------------------------------------------
// Unicode scalar generation (valid scalars only — never lone surrogates)
// ---------------------------------------------------------------------------

// Singletons / marks with canonical (NFC-relevant) behavior — prime suspects
// for Unicode-version skew between the three normalization backends.
const INTERESTING = [
  0x00c5, 0x00e9, 0x00f1, 0x0100, 0x0212, // precomposed Latin
  0x0300, 0x0301, 0x0302, 0x0303, 0x0308, 0x0327, 0x0328, 0x0334, 0x0345, // combining
  0x0340, 0x0341, 0x0343, 0x0344, // combining marks with canonical decompositions
  0x0958, 0x0959, 0x095a, 0x095f, // Devanagari with canonical decomp (composition exclusions)
  0x09dc, 0x09dd, 0x0a33, 0x0a59, 0x0b5c, 0x0f43, 0x0f4d, // more composition exclusions
  0x1e0a, 0x1e9b, 0x1f00, 0x1fbe, // Latin/Greek extended
  0x2126, 0x212a, 0x212b, // OHM / KELVIN / ANGSTROM (canonical singletons)
  0x2000, 0x2001, // EN/EM QUAD canonical-decompose to spaces
  0x2329, 0x232a, // angle brackets -> CJK
  0xf900, 0xfa10, 0xfa1f, 0xfad9, // CJK compat ideographs (canonical decomp)
  0xfb1d, 0xfb1f, // Hebrew presentation with canonical decomp
  0x110ab, 0x1109a, 0x1109c, // Kaithi etc. composition exclusions (astral)
  0x1d15e, 0x1d1bb, // musical symbols with canonical decomp (astral)
  0x2f800, 0x2fa1d, // CJK Compatibility Ideographs Supplement (astral, canonical decomp)
  0xfeff, // BOM
  0x0000, 0x001f, 0x007f, // control
];

// Hangul: L (0x1100–0x1112), V (0x1161–0x1175), T (0x11A8–0x11C2), syllables.
function hangulScalar() {
  switch (ri(4)) {
    case 0: return 0x1100 + ri(19); // L
    case 1: return 0x1161 + ri(21); // V
    case 2: return 0x11a7 + ri(28); // T (0x11A7 filler.. include range)
    default: return 0xac00 + ri(0xd7a3 - 0xac00 + 1); // syllable
  }
}

function randScalar() {
  const r = rng();
  let cp;
  if (r < 0.22) cp = 0x20 + ri(0x5f); // ASCII printable
  else if (r < 0.34) cp = 0x300 + ri(0x70); // combining diacritics
  else if (r < 0.46) cp = 0xc0 + ri(0x250 - 0xc0); // Latin-1 supp + Latin Extended-A
  else if (r < 0.56) cp = hangulScalar();
  else if (r < 0.66) cp = pick(INTERESTING);
  else if (r < 0.74) cp = 0xf900 + ri(0xfad9 - 0xf900 + 1); // CJK compat
  else if (r < 0.82) cp = 0x10000 + ri(0x10ffff - 0x10000 + 1); // random astral
  else cp = ri(0x10000); // any BMP
  if (cp >= 0xd800 && cp <= 0xdfff) cp = 0x41; // never a surrogate
  return cp;
}

// A random string: a short sequence of scalars, biased toward base+mark runs
// (so canonical composition/ordering is exercised).
function randString(maxLen = 6) {
  const n = ri(maxLen) + 1;
  let s = "";
  for (let i = 0; i < n; i++) {
    if (chance(0.4)) {
      // base then 1-3 combining marks (decomposition/reordering territory)
      s += String.fromCodePoint(pick([0x61, 0x65, 0x6f, 0x75, 0x41, 0x3b1, 0x1100, 0xac00, randScalar()]));
      const marks = ri(3);
      for (let m = 0; m < marks; m++) s += String.fromCodePoint(0x300 + ri(0x70));
    } else {
      s += String.fromCodePoint(randScalar());
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// per-op case generators -> a TSV line
// ---------------------------------------------------------------------------
const hx = (s) => Buffer.from(s, "utf8").toString("hex");
const TAGS = [
  "PARADIGM_TERRA_DSL_V1.1", "PARADIGM_TERRA_DSL_V1.2", "PARADIGM_TERRA_MERKLE_LEAF_V1",
  "PARADIGM_TERRA_MERKLE_NODE_V1", "PARADIGM_TERRA_STATE_V1", "PARADIGM_TERRA_STATE_ROOT_V1",
  "PARADIGM_TERRA_CAL_V1", "PARADIGM_TERRA_ADDRESS_V1",
];

function randBigDecimal(maxBits) {
  // random integer in [-(2^maxBits), 2^maxBits], as canonical decimal text
  const bits = ri(maxBits) + 1;
  let v = 0n;
  for (let i = 0; i < bits; i++) v = (v << 1n) | BigInt(ri(2));
  if (chance(0.5)) v = -v;
  return v.toString(10);
}

function genInt256() {
  if (chance(0.25)) {
    // boundary / out-of-range
    const b = pick([
      (1n << 255n) - 1n, -(1n << 255n), 1n << 255n, -(1n << 255n) - 1n,
      0n, -1n, 1n, (1n << 256n), (1n << 255n) - 1n + 1n,
    ]);
    return `int256\t${hx(b.toString(10))}`;
  }
  return `int256\t${hx(randBigDecimal(258))}`;
}
function genUint256() {
  if (chance(0.25)) {
    const b = pick([0n, 1n, (1n << 256n) - 1n, 1n << 256n, -1n, (1n << 255n)]);
    return `uint256\t${hx(b.toString(10))}`;
  }
  let v = BigInt(randBigDecimal(258));
  if (chance(0.5) && v < 0n) v = -v;
  return `uint256\t${hx(v.toString(10))}`;
}
function genUint64() {
  if (chance(0.3)) {
    const b = pick([0n, 1n, (1n << 64n) - 1n, 1n << 64n, -1n, (1n << 63n)]);
    return `uint64\t${hx(b.toString(10))}`;
  }
  return `uint64\t${hx(randBigDecimal(70))}`;
}
function genNfc() {
  let s = randString(7);
  if (chance(0.06)) s = "﻿" + s; // leading BOM (all should reject)
  return `nfc\t${hx(s)}`;
}
function genAddress() {
  const hexHash = () => Array.from({ length: 64 }, () => "0123456789abcdef"[ri(16)]).join("");
  let addr;
  const r = rng();
  if (r < 0.5) addr = `${ri(256) - 128}:${hexHash()}`; // valid-ish
  else if (r < 0.6) addr = `${ri(256) - 128}:${hexHash().toUpperCase()}`; // uppercase hex -> reject
  else if (r < 0.7) addr = `${ri(100000)}:${hexHash()}`; // workchain out of int8 -> reject
  else if (r < 0.8) addr = `${ri(256) - 128}:${hexHash().slice(0, 63)}`; // short hash -> reject
  else if (r < 0.9) addr = randString(10); // garbage
  else addr = `0:${hexHash()}`;
  return `address\t${hx(addr)}`;
}
function genFrame() {
  const tt = ri(0x10000);
  const vv = ri(0x10000);
  const plen = ri(40);
  const payload = Array.from({ length: plen }, () => "0123456789abcdef"[ri(16)] + "0123456789abcdef"[ri(16)]).join("");
  return `frame\t${tt}\t${vv}\t${payload}`;
}
function genMerkle() {
  const tag = chance(0.85) ? "PARADIGM_TERRA_MERKLE_NODE_V1" : pick(TAGS.concat([randString(8)]));
  const count = ri(18); // 0..17 (0 -> all reject)
  const leaf = () => Array.from({ length: 64 }, () => "0123456789abcdef"[ri(16)]).join("");
  let leaves = Array.from({ length: count }, leaf);
  if (count > 0 && chance(0.05)) leaves[ri(count)] = leaf().slice(0, 62); // wrong length -> reject
  return `merkle\t${hx(tag)}\t${leaves.join(",")}`;
}
function genDomainHash() {
  let tag;
  const r = rng();
  if (r < 0.6) tag = pick(TAGS);
  else if (r < 0.75) tag = randString(10); // arbitrary (non-ASCII -> reject)
  else if (r < 0.85) tag = ""; // empty -> reject
  else if (r < 0.92) tag = "ASCII_TAG_" + ri(1000);
  else tag = "tag with_nul"; // NUL -> reject
  const plen = ri(48);
  const payload = Array.from({ length: plen }, () => "0123456789abcdef"[ri(16)] + "0123456789abcdef"[ri(16)]).join("");
  return `domain_hash\t${hx(tag)}\t${payload}`;
}

// ---- JCS document generation ---------------------------------------------
// Builds a random JCS value, then serializes it to a NON-canonical JSON text
// (random key order, random insignificant whitespace) so the canonicalizer must
// do real work. Also emits malformed documents to test rejection parity.

function randJcsValue(depth) {
  const r = rng();
  if (depth <= 0 || r < 0.35) {
    const t = ri(5);
    if (t === 0) return { k: "null" };
    if (t === 1) return { k: "bool", v: chance(0.5) };
    if (t === 2) return { k: "int", v: randBigDecimal(80) };
    return { k: "str", v: randString(5) };
  }
  if (r < 0.7) {
    const n = ri(4);
    return { k: "arr", v: Array.from({ length: n }, () => randJcsValue(depth - 1)) };
  }
  const n = ri(4);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push([randString(4), randJcsValue(depth - 1)]);
  if (n >= 2 && chance(0.1)) pairs[1][0] = pairs[0][0]; // duplicate key -> reject
  return { k: "obj", v: pairs };
}

function jsonEscape(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0d) out += "\\r";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else if (chance(0.15) && c <= 0xffff) out += "\\u" + c.toString(16).padStart(4, "0"); // random BMP escaping
    else out += ch;
  }
  return out + '"';
}
const ws = () => " \t\n\r".slice(0, 1).repeat(0) + Array.from({ length: ri(3) }, () => pick([" ", "\t", "\n", "\r"])).join("");
function renderJcs(node) {
  switch (node.k) {
    case "null": return "null";
    case "bool": return node.v ? "true" : "false";
    case "int": return node.v;
    case "str": return jsonEscape(node.v);
    case "arr": return "[" + ws() + node.v.map((x) => renderJcs(x)).join(ws() + "," + ws()) + ws() + "]";
    case "obj": {
      const parts = node.v.map(([k, val]) => jsonEscape(k) + ws() + ":" + ws() + renderJcs(val));
      return "{" + ws() + parts.join(ws() + "," + ws()) + ws() + "}";
    }
  }
}
const MALFORMED = [
  "", "  ", "{", "[", "}", "]", "{}extra", "[1,]", "{,}", "{\"a\"}", "{\"a\":}",
  '"\\uD800"', '"\\uDC00"', '"\\uD83D\\uDE00"', '"\\uXYZW"', '"\\q"', '"unterminated',
  "01", "-0", "1.5", "1e3", "+5", "00", "-01", "1 2", "truefalse", "nul", "NaN",
  '{"a":1,"a":2}', '""', "[1 2]", '{"k":1 "j":2}', "﻿{}",
];
function genJcs() {
  if (chance(0.12)) return `jcs\t${hx(pick(MALFORMED))}`;
  const doc = renderJcs(randJcsValue(4));
  return `jcs\t${hx(doc)}`;
}

const GENERATORS = {
  int256: genInt256, uint256: genUint256, uint64: genUint64, nfc: genNfc,
  jcs: genJcs, address: genAddress, frame: genFrame, merkle: genMerkle,
  domain_hash: genDomainHash,
};
const OP_NAMES = Object.keys(GENERATORS);

function genCase() {
  const op = ONLY_OP ?? pick(OP_NAMES);
  return GENERATORS[op]();
}

// ---------------------------------------------------------------------------
// running the harnesses
// ---------------------------------------------------------------------------
function runHarness(key, input) {
  const h = HARNESSES[key];
  const out = execFileSync(h.cmd, h.args, {
    input,
    maxBuffer: 1024 * 1024 * 1024,
    encoding: "utf8",
  });
  // split, dropping a single trailing newline
  const lines = out.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function runAll(cases) {
  const input = cases.join("\n") + "\n";
  const res = {};
  for (const key of ["ts", "go", "rs"]) {
    res[key] = runHarness(key, input);
    if (res[key].length !== cases.length) {
      console.error(
        `PROTOCOL ERROR: ${key} returned ${res[key].length} lines for ${cases.length} cases`,
      );
      process.exit(2);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// reporting helpers
// ---------------------------------------------------------------------------
function describe(line) {
  const f = line.split("\t");
  const op = f[0];
  const unhex = (h) => Buffer.from(h ?? "", "hex");
  const cps = (s) => Array.from(s).map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
  if (["nfc", "jcs", "address", "int256", "uint256", "uint64"].includes(op)) {
    const s = unhex(f[1]).toString("utf8");
    return `${op}  ${JSON.stringify(s)}  [${cps(s)}]`;
  }
  if (op === "domain_hash") return `domain_hash tag=${JSON.stringify(unhex(f[1]).toString("utf8"))} payloadHex=${f[2]}`;
  if (op === "merkle") return `merkle tag=${JSON.stringify(unhex(f[1]).toString("utf8"))} leaves=${(f[2] || "").split(",").filter(Boolean).length}`;
  if (op === "frame") return `frame typeTag=${f[1]} version=${f[2]} payloadHex=${f[3] ?? ""}`;
  return line;
}

// ---------------------------------------------------------------------------
// minimization: for nfc/jcs string cases, shrink to the smallest input that
// still diverges (delta-debug over the scalar sequence).
// ---------------------------------------------------------------------------
function divergesSingle(line) {
  const r = runAll([line]);
  return !(r.ts[0] === r.go[0] && r.go[0] === r.rs[0]);
}
function minimizeStringCase(line) {
  const f = line.split("\t");
  const op = f[0];
  if (op !== "nfc" && op !== "jcs") return line;
  let s = Buffer.from(f[1], "hex").toString("utf8");
  let scalars = Array.from(s);
  let changed = true;
  while (changed && scalars.length > 1) {
    changed = false;
    for (let i = 0; i < scalars.length; i++) {
      const trial = scalars.slice(0, i).concat(scalars.slice(i + 1));
      const cand = `${op}\t${hx(trial.join(""))}`;
      if (divergesSingle(cand)) {
        scalars = trial;
        changed = true;
        break;
      }
    }
  }
  return `${op}\t${hx(scalars.join(""))}`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
console.log(`diff-fuzz: ${N} cases, seed=${SEED}${ONLY_OP ? `, op=${ONLY_OP}` : ""}`);
const cases = Array.from({ length: N }, genCase);
const res = runAll(cases);

const divergences = [];
const byOp = {};
for (const op of OP_NAMES) byOp[op] = { total: 0, diverge: 0 };
for (let i = 0; i < cases.length; i++) {
  const op = cases[i].split("\t")[0];
  byOp[op].total++;
  const { ts, go, rs } = { ts: res.ts[i], go: res.go[i], rs: res.rs[i] };
  if (ts === go && go === rs) continue;
  byOp[op].diverge++;
  divergences.push({ i, op, line: cases[i], ts, go, rs });
}

console.log("\nper-op counts (total / divergences):");
for (const op of OP_NAMES) {
  if (byOp[op].total) console.log(`  ${op.padEnd(12)} ${String(byOp[op].total).padStart(7)} / ${byOp[op].diverge}`);
}

if (divergences.length === 0) {
  console.log(`\n✅ NO DIVERGENCES across ${N} cases. Three implementations agree byte-for-byte.`);
  process.exit(0);
}

console.log(`\n❌ ${divergences.length} DIVERGENCE(S) FOUND.\n`);

// Group by a signature (op + which impls form the majority) to dedupe noise.
const groups = new Map();
for (const d of divergences) {
  const sig = `${d.op} | ts=${d.ts.slice(0, 6)} go=${d.go.slice(0, 6)} rs=${d.rs.slice(0, 6)}`;
  if (!groups.has(d.op)) groups.set(d.op, []);
  groups.get(d.op).push(d);
}

mkdirSync(resolve(HERE, "out"), { recursive: true });
const outPath = resolve(HERE, "out", "divergences.jsonl");
writeFileSync(outPath, "");

let shown = 0;
for (const [op, list] of groups) {
  console.log(`### op=${op}: ${list.length} divergence(s)`);
  for (const d of list) {
    const rec = { ...d };
    if (DO_MIN) {
      const min = minimizeStringCase(d.line);
      if (min !== d.line) {
        rec.minimized = min;
        const mr = runAll([min]);
        rec.min_ts = mr.ts[0];
        rec.min_go = mr.go[0];
        rec.min_rs = mr.rs[0];
      }
    }
    appendFileSync(outPath, JSON.stringify(rec) + "\n");
    if (shown < SHOW) {
      shown++;
      console.log(`  • ${describe(rec.minimized ?? d.line)}`);
      const t = rec.minimized ? { ts: rec.min_ts, go: rec.min_go, rs: rec.min_rs } : d;
      console.log(`      ts: ${t.ts}`);
      console.log(`      go: ${t.go}`);
      console.log(`      rs: ${t.rs}`);
      if (rec.minimized) console.log(`      (minimized from ${describe(d.line)})`);
    }
  }
}
console.log(`\nFull divergence records → ${outPath}`);
process.exit(1);
