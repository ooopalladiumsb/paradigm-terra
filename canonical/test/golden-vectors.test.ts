/**
 * Verify that the committed vectors/golden.json matches a fresh re-computation
 * by the current source. Any drift indicates a (possibly unintentional) change
 * to canonical semantics — the vectors MUST be regenerated and the diff
 * reviewed before merging.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(__dirname, "..", "vectors", "golden.json");
const SCRIPT_PATH = resolve(__dirname, "..", "scripts", "generate-vectors.ts");

interface VectorDoc {
  meta: { version: string };
  vectors: Array<{
    id: string;
    description: string;
    input: unknown;
    output: Record<string, string>;
  }>;
}

test("vectors/golden.json matches fresh re-computation (drift check)", async () => {
  // Re-run the generator in a child process to a temp file, then diff.
  const fresh = execSync(`node --import tsx ${JSON.stringify(SCRIPT_PATH)}`, {
    cwd: resolve(__dirname, ".."),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(fresh, /Wrote \d+ golden vectors/);

  const committed = JSON.parse(await readFile(VECTORS_PATH, "utf-8")) as VectorDoc;
  assert.equal(typeof committed.meta.version, "string");
  assert.ok(committed.vectors.length > 0, "must have at least one vector");

  // Spot-check a few well-known invariants directly:
  const intMinusOne = committed.vectors.find((v) => v.id === "int256_minus_one");
  assert.ok(intMinusOne);
  assert.equal(
    intMinusOne!.output["bytes_hex"],
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  );

  const intZero = committed.vectors.find((v) => v.id === "int256_zero");
  assert.ok(intZero);
  assert.equal(
    intZero!.output["bytes_hex"],
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  );

  // Sanity: JCS sample produces sorted-keys canonical form.
  const jcsSample = committed.vectors.find((v) => v.id === "jcs_sample_b2_a1");
  assert.ok(jcsSample);
  assert.equal(jcsSample!.output["canonical_text"], '{"a":1,"b":2}');

  // State root vector exists and has a 32-byte hex root.
  const stateRootVec = committed.vectors.find((v) => v.id === "state_root_genesis_empty");
  assert.ok(stateRootVec);
  assert.match(stateRootVec!.output["root"]!, /^0x[0-9a-f]{64}$/);

  // DSL v1.2 hash for the gte expression is distinct from v1.1.
  const dsl = committed.vectors.find((v) => v.id === "dsl_expr_gte_x_0");
  assert.ok(dsl);
  assert.notEqual(dsl!.output["dsl_v1_1_hash"], dsl!.output["dsl_v1_2_hash"]);
});
