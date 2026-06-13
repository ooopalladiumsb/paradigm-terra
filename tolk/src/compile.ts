// L2.0 — the shared Layer-2 Tolk build harness.
//
// Reusable, contract-agnostic: compile any `contracts/<name>.tolk` through the PINNED @ton/tolk-js
// compiler and produce a golden artifact (code BoC + code hash + compiler version). Determinism — same
// source + same pinned compiler ⇒ identical codeHashHex — is the drift guard every Layer-2 contract
// inherits (the m2-registry SC-1 pattern, generalized). NON-NORMATIVE, Tier M, above the Freeze Surface.
// No network, no deploy — testnet deploy is a per-contract GATED step (charter §5).
import { runTolkCompiler, getTolkCompilerVersion } from "@ton/tolk-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CompiledArtifact {
  /** entrypoint path relative to the contracts root, e.g. "example-counter.tolk" */
  readonly contract: string;
  /** the @ton/tolk-js compiler version that produced this artifact (pinned) */
  readonly tolkVersion: string;
  /** sha256 of the code cell, hex (the golden drift-guard value) */
  readonly codeHashHex: string;
  /** the compiled code cell as a base64 BoC (deploy input) */
  readonly codeBoc64: string;
}

/** Compile one Tolk entrypoint resolved under `contractsDir`. Throws on any compiler error. */
export async function compileTolk(contractsDir: string, entrypoint: string): Promise<CompiledArtifact> {
  const res = await runTolkCompiler({
    entrypointFileName: entrypoint,
    fsReadCallback: (path: string) => readFileSync(join(contractsDir, path), "utf-8"),
  });
  if (res.status === "error") throw new Error(`Tolk compile failed (${entrypoint}):\n${res.message}`);
  return { contract: entrypoint, tolkVersion: res.tolkVersion, codeHashHex: res.codeHashHex, codeBoc64: res.codeBoc64 };
}

/** The pinned compiler version this harness builds against. */
export function pinnedTolkVersion(): Promise<string> {
  return getTolkCompilerVersion();
}

/** Drift guard: the artifact must have been produced by the pinned compiler. */
export function assertPinned(art: CompiledArtifact, pinned: string): void {
  if (art.tolkVersion !== pinned) {
    throw new Error(`Tolk compiler drift: artifact ${art.tolkVersion} != pinned ${pinned}`);
  }
}
