// Exhaustive single-code-point NFC sweep across the three implementations.
//
// For every Unicode scalar value (0..0x10FFFF minus the surrogate gap) it asks
// each harness to NFC-normalize the 1-char string and records every code point
// where the three do not all agree. Single-code-point divergences are the
// cleanest signal of a Unicode-data-version mismatch between the backends
// (Node ICU vs Rust unicode-normalization vs Go x/text).
//
// Usage: node fuzz/nfc_sweep.mjs [--chunk 100000]

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
const CHUNK = Number.parseInt(process.argv.includes("--chunk") ? process.argv[process.argv.indexOf("--chunk") + 1] : "120000", 10);

function run(key, input) {
  const out = execFileSync(H[key].cmd, H[key].args, { input, maxBuffer: 1 << 30, encoding: "utf8" });
  const lines = out.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const all = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  all.push(cp);
}
console.log(`NFC single-codepoint sweep: ${all.length} scalars, chunk=${CHUNK}`);

const diffs = [];
const classTally = { "TS=RS≠GO": 0, "TS=GO≠RS": 0, "GO=RS≠TS": 0, "all-differ": 0, "split-accept": 0 };

for (let start = 0; start < all.length; start += CHUNK) {
  const cps = all.slice(start, start + CHUNK);
  const input = cps.map((cp) => "nfc\t" + Buffer.from(String.fromCodePoint(cp), "utf8").toString("hex")).join("\n") + "\n";
  const ts = run("ts", input), go = run("go", input), rs = run("rs", input);
  for (let i = 0; i < cps.length; i++) {
    if (ts[i] === go[i] && go[i] === rs[i]) continue;
    const cp = cps[i];
    let cls;
    const okAll = ts[i].startsWith("OK") && go[i].startsWith("OK") && rs[i].startsWith("OK");
    if (!okAll) cls = "split-accept";
    else if (ts[i] === rs[i]) cls = "TS=RS≠GO";
    else if (ts[i] === go[i]) cls = "TS=GO≠RS";
    else if (go[i] === rs[i]) cls = "GO=RS≠TS";
    else cls = "all-differ";
    classTally[cls]++;
    diffs.push({ cp, hex: cp.toString(16).toUpperCase().padStart(4, "0"), cls, ts: ts[i], go: go[i], rs: rs[i] });
  }
  process.stdout.write(`  swept ${Math.min(start + CHUNK, all.length)}/${all.length}, divergences so far: ${diffs.length}\r`);
}
process.stdout.write("\n");

mkdirSync(resolve(HERE, "out"), { recursive: true });
writeFileSync(resolve(HERE, "out", "nfc_divergent_codepoints.jsonl"), diffs.map((d) => JSON.stringify(d)).join("\n") + "\n");

console.log(`\nTotal diverging single code points: ${diffs.length}`);
console.log("classes:", JSON.stringify(classTally, null, 0));

// Summarize contiguous ranges per class for readability.
function ranges(cps) {
  cps.sort((a, b) => a - b);
  const out = [];
  let s = cps[0], p = cps[0];
  for (let i = 1; i < cps.length; i++) {
    if (cps[i] === p + 1) { p = cps[i]; continue; }
    out.push([s, p]); s = cps[i]; p = cps[i];
  }
  if (cps.length) out.push([s, p]);
  return out;
}
const fmt = (n) => "U+" + n.toString(16).toUpperCase().padStart(4, "0");
for (const cls of Object.keys(classTally)) {
  const cps = diffs.filter((d) => d.cls === cls).map((d) => d.cp);
  if (!cps.length) continue;
  const rs = ranges(cps);
  console.log(`\n### ${cls} (${cps.length} code points, ${rs.length} ranges)`);
  console.log("  " + rs.slice(0, 40).map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)}..${fmt(b)}`)).join("  "));
  if (rs.length > 40) console.log(`  ...(+${rs.length - 40} more ranges)`);
}

// Show a few concrete examples with decoded outputs.
console.log("\nexamples (decoded NFC bytes):");
const decode = (line) => (line.startsWith("OK ") ? line.slice(3) : line);
for (const d of diffs.slice(0, 16)) {
  console.log(`  ${fmt(d.cp)} [${d.cls}]  ts=${decode(d.ts)}  go=${decode(d.go)}  rs=${decode(d.rs)}`);
}
