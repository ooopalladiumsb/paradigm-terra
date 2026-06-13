/**
 * L2.0 — the harness drift guard. Recompiling each Layer-2 contract through the pinned @ton/tolk-js must
 * reproduce the committed golden code hash + version. This is the reproducible-build axis every Layer-2
 * contract inherits (the m2-registry SC-1 pattern, generalized). Offline.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertPinned, compileTolk, pinnedTolkVersion, type CompiledArtifact } from "../src/compile.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const goldenOf = (entry: string): CompiledArtifact =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "build", entry.replace(/\.tolk$/, ".compiled.json")), "utf8"));

test("L2.0: example-counter recompiles to the committed golden code hash + pinned version", async () => {
  const entry = "example-counter.tolk";
  const golden = goldenOf(entry);
  const pinned = await pinnedTolkVersion();
  const fresh = await compileTolk(CONTRACTS_DIR, entry);

  assertPinned(fresh, pinned); // built against the pinned compiler
  assert.equal(fresh.tolkVersion, golden.tolkVersion, "compiler version drifted from the committed artifact");
  assert.equal(fresh.codeHashHex, golden.codeHashHex, "code hash drifted — source or compiler changed");
  assert.equal(fresh.codeBoc64, golden.codeBoc64, "code BoC drifted from the committed artifact");
});

test("L2.0: a missing entrypoint fails loudly (harness error path)", async () => {
  await assert.rejects(() => compileTolk(CONTRACTS_DIR, "does-not-exist.tolk"));
});
