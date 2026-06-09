// M2-A · SC-1 — reproducible build of the Registry reconciliation contract.
// Compiles contracts/reconciliation_registry.tolk with the PINNED @ton/tolk-js compiler and emits the
// code BoC + its code hash to build/registry.compiled.json. Determinism (same source + same pinned
// compiler ⇒ identical codeHashHex) is the SC-1 evidence; test/build.test.ts asserts it.
// NON-NORMATIVE operational artifact (Tier M). No network, no deploy — that is M2-C, gated.
import { runTolkCompiler, getTolkCompilerVersion } from "@ton/tolk-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINT = "contracts/reconciliation_registry.tolk";
const OUT = join(ROOT, "build", "registry.compiled.json");

export type CompiledArtifact = {
  contract: string;
  tolkVersion: string;
  codeHashHex: string;
  codeBoc64: string;
};

/** Compile the contract through the pinned Tolk compiler. Throws on any compiler error. */
export async function compile(): Promise<CompiledArtifact> {
  const res = await runTolkCompiler({
    entrypointFileName: ENTRYPOINT,
    fsReadCallback: (path: string) => readFileSync(join(ROOT, path), "utf-8"),
  });
  if (res.status === "error") throw new Error(`Tolk compile failed:\n${res.message}`);
  return {
    contract: ENTRYPOINT,
    tolkVersion: res.tolkVersion,
    codeHashHex: res.codeHashHex,
    codeBoc64: res.codeBoc64,
  };
}

async function main() {
  const pinned = await getTolkCompilerVersion();
  const art = await compile();
  if (art.tolkVersion !== pinned) {
    throw new Error(`compiler version drift: artifact ${art.tolkVersion} != pinned ${pinned}`);
  }
  writeFileSync(OUT, JSON.stringify(art, null, 2) + "\n");
  console.log(`✅ built ${art.contract}`);
  console.log(`   tolk     ${art.tolkVersion}`);
  console.log(`   codeHash ${art.codeHashHex}`);
  console.log(`   → ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
