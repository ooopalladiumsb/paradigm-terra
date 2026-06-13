// L2.6 — emit the pinned genesis manifest for a REFERENCE owner. Re-running reproduces the committed
// addresses + code hashes (the test/genesis.test.ts drift guard). The live genesis recomputes the manifest
// for the real publisher wallet; this reference manifest pins the deploy surface's determinism. Offline.
// Run: `node --import tsx scripts/genesis.ts`.
import { Address } from "@ton/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genesisManifest } from "../src/genesis.ts";

// A fixed reference publisher (NOT a live wallet) — pins determinism only; the live genesis uses the
// real operator. Raw 0:11..11.
export const REFERENCE_OWNER = Address.parseRaw("0:" + "11".repeat(32));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "artifacts", "genesis");

function main(): void {
  const manifest = genesisManifest(REFERENCE_OWNER);
  const out = {
    note: "L2.6 genesis manifest for the REFERENCE owner (0:11..11) — deterministic deploy surface of the Layer-2 observational suite. The live genesis recomputes for the real publisher. Framing A: deploys read-model projections, creates no consensus.",
    referenceOwner: REFERENCE_OWNER.toRawString(),
    contracts: manifest,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "genesis-manifest.json"), JSON.stringify(out, null, 2) + "\n");
  for (const e of manifest) console.log(`✅ ${e.name.padEnd(14)} code ${e.codeHash.slice(0, 12)}…  addr ${e.address}`);
  console.log(`→ ${join(OUT_DIR, "genesis-manifest.json")}`);
}

main();
