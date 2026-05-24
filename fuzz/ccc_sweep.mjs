// Combining-class divergence sweep across the three NFC backends.
//
// A single-codepoint NFC sweep (nfc_sweep.mjs) cannot see canonical-ordering
// (ccc) differences: one combining mark normalizes to itself regardless of its
// combining class. To expose ccc skew between the backends we normalize a short
// SEQUENCE for every scalar `cp` and compare the three outputs:
//
//   P1 = "a" + cp + U+0334(ccc 1)     -> reorders iff ccc(cp) > 1
//   P2 = "a" + U+0360(ccc 234) + cp   -> reorders iff 0 < ccc(cp) < 234
//
// Together these flag any cp whose effective combining class differs between
// the backends — most importantly marks assigned after Unicode 15.0 (Go's
// x/text on Go 1.26 = Unicode 15.0) but present in 16.0/17.0 (Node ICU / Rust
// unicode-normalization). Output: every divergent code point, grouped by class.
//
// Usage: node fuzz/ccc_sweep.mjs [--chunk 80000]

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const H = {
  ts: { cmd: "node", args: [resolve(HERE, "ts_harness.mjs")] },
  go: { cmd: resolve(HERE, "bin", "go_harness"), args: [] },
  rs: { cmd: resolve(ROOT, "canonical-rs/target/x86_64-unknown-linux-musl/debug/fuzz_harness"), args: [] },
};
const CHUNK = Number.parseInt(process.argv.includes("--chunk") ? process.argv[process.argv.indexOf("--chunk") + 1] : "80000", 10);

function run(key, input) {
  const out = execFileSync(H[key].cmd, H[key].args, { input, maxBuffer: 1 << 30, encoding: "utf8" });
  const lines = out.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const hex = (s) => Buffer.from(s, "utf8").toString("hex");
const A = "a";
const LOW = "̴";   // ccc 1
const HIGH = "͠";  // ccc 234

const all = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  all.push(cp);
}
console.log(`ccc sweep: ${all.length} scalars x 2 probes, chunk=${CHUNK}`);

const diffs = [];
for (let start = 0; start < all.length; start += CHUNK) {
  const cps = all.slice(start, start + CHUNK);
  // interleave P1 and P2 for each cp
  const lines = [];
  for (const cp of cps) {
    const c = String.fromCodePoint(cp);
    lines.push("nfc\t" + hex(A + c + LOW));
    lines.push("nfc\t" + hex(A + HIGH + c));
  }
  const input = lines.join("\n") + "\n";
  const ts = run("ts", input), go = run("go", input), rs = run("rs", input);
  for (let i = 0; i < cps.length; i++) {
    const a = 2 * i, b = 2 * i + 1;
    const p1div = !(ts[a] === go[a] && go[a] === rs[a]);
    const p2div = !(ts[b] === go[b] && go[b] === rs[b]);
    if (!p1div && !p2div) continue;
    const cp = cps[i];
    diffs.push({
      cp, hex: "U+" + cp.toString(16).toUpperCase().padStart(4, "0"),
      probe: p1div && p2div ? "P1+P2" : p1div ? "P1" : "P2",
      ts_go_rs_agree: `ts=${ts[a] === ts[b] ? "" : ""}`, // placeholder
      p1: p1div ? { ts: ts[a], go: go[a], rs: rs[a] } : null,
      p2: p2div ? { ts: ts[b], go: go[b], rs: rs[b] } : null,
    });
  }
  process.stdout.write(`  swept ${Math.min(start + CHUNK, all.length)}/${all.length}, divergent cps: ${diffs.length}\r`);
}
process.stdout.write("\n");

mkdirSync(resolve(HERE, "out"), { recursive: true });
writeFileSync(resolve(HERE, "out", "ccc_divergent_codepoints.jsonl"), diffs.map((d) => JSON.stringify(d)).join("\n") + "\n");

// classify: which pair is the majority (TS=RS vs others) — expect TS=RS (17.0) vs GO (15.0)
let tsRsVsGo = 0, other = 0;
for (const d of diffs) {
  const p = d.p1 || d.p2;
  if (p.ts === p.rs && p.ts !== p.go) tsRsVsGo++;
  else other++;
}

// contiguous ranges
function ranges(cps) {
  cps.sort((a, b) => a - b);
  const out = [];
  if (!cps.length) return out;
  let s = cps[0], p = cps[0];
  for (let i = 1; i < cps.length; i++) {
    if (cps[i] === p + 1) { p = cps[i]; continue; }
    out.push([s, p]); s = cps[i]; p = cps[i];
  }
  out.push([s, p]);
  return out;
}
const fmt = (n) => "U+" + n.toString(16).toUpperCase().padStart(4, "0");
const rs = ranges(diffs.map((d) => d.cp));
console.log(`\nTotal divergent code points: ${diffs.length}`);
console.log(`  TS=RS (17.0) vs GO (15.0): ${tsRsVsGo}   other split: ${other}`);
console.log(`  contiguous ranges (${rs.length}):`);
console.log("  " + rs.slice(0, 60).map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)}..${fmt(b)}`)).join("  "));
if (rs.length > 60) console.log(`  ...(+${rs.length - 60} more ranges)`);

console.log("\nfirst examples:");
for (const d of diffs.slice(0, 12)) {
  const p = d.p1 || d.p2;
  console.log(`  ${d.hex} [${d.probe}]  ts=${p.ts}  go=${p.go}  rs=${p.rs}`);
}
