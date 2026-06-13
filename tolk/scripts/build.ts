// L2.0 — build all Layer-2 Tolk contracts to golden artifacts.
//
// Compiles every entrypoint in CONTRACTS through the pinned @ton/tolk-js compiler and writes
// build/<name>.compiled.json (code BoC + code hash + version). Committing these makes the code hash a
// drift-guarded golden (test/build.test.ts re-derives and compares). Run: `node --import tsx scripts/build.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPinned, compileTolk, pinnedTolkVersion } from "../src/compile.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = join(ROOT, "contracts");
const BUILD_DIR = join(ROOT, "build");

// The Layer-2 contract set (entrypoints under contracts/). Grows as L2.1+ land.
const CONTRACTS = ["example-counter.tolk", "registry.tolk", "treasury.tolk"];

async function main(): Promise<void> {
  const pinned = await pinnedTolkVersion();
  mkdirSync(BUILD_DIR, { recursive: true });
  for (const entry of CONTRACTS) {
    const art = await compileTolk(CONTRACTS_DIR, entry);
    assertPinned(art, pinned);
    const out = join(BUILD_DIR, entry.replace(/\.tolk$/, ".compiled.json"));
    writeFileSync(out, JSON.stringify(art, null, 2) + "\n");
    console.log(`✅ ${entry}  tolk ${art.tolkVersion}  codeHash ${art.codeHashHex}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
