import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeMcpSchemaHash,
  mcpSchemaToolsetBytes,
  canonicalizeMcpToolNames,
  CanonicalEncodingError,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(__dirname, "..", "..", "tools", "mcp", "vectors.json");

interface Vector {
  id: string;
  description: string;
  input: { tool_names: unknown[] };
  expect:
    | {
        kind: "ok";
        canonical_bytes_utf8: string;
        canonical_bytes_sha256_hex: string;
        mcp_schema_hash_hex: string;
      }
    | { kind: "error"; error_code: string };
}

const fixture = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as { vectors: Vector[] };

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

for (const v of fixture.vectors) {
  test(`mcp vector: ${v.id} — ${v.description}`, () => {
    if (v.expect.kind === "ok") {
      const bytes = mcpSchemaToolsetBytes(v.input.tool_names as string[]);
      const utf8 = Buffer.from(bytes).toString("utf8");
      assert.equal(utf8, v.expect.canonical_bytes_utf8, "canonical bytes differ");
      assert.equal(sha256Hex(bytes), v.expect.canonical_bytes_sha256_hex, "file SHA-256 differs");
      const hash = computeMcpSchemaHash(v.input.tool_names as string[]);
      assert.equal(toHex(hash), v.expect.mcp_schema_hash_hex, "MCP_SCHEMA_HASH differs");
    } else {
      let actual: string | null = null;
      try {
        computeMcpSchemaHash(v.input.tool_names as string[]);
      } catch (e) {
        if (e instanceof CanonicalEncodingError) actual = e.code;
        else throw e;
      }
      assert.equal(actual, v.expect.error_code, "wrong error code");
    }
  });
}

// Structural cross-checks (independent of the vector file).
test("canonicalizeMcpToolNames is idempotent on already-sorted input", () => {
  const xs = ["a_tool", "b_tool", "c_tool"];
  assert.deepEqual(canonicalizeMcpToolNames(xs), xs);
});

test("canonicalizeMcpToolNames returns a copy (no input mutation)", () => {
  const xs = ["b", "a"];
  const sorted = canonicalizeMcpToolNames(xs);
  assert.deepEqual(xs, ["b", "a"]);
  assert.deepEqual(sorted, ["a", "b"]);
});

test("order-independence: 1000 random shuffles of the pinned set produce the same hash", () => {
  const pinned = JSON.parse(
    readFileSync(resolve(__dirname, "..", "..", "tools", "mcp", "mcp-schema-v1-tools.json"), "utf8"),
  ) as string[];
  const baseline = toHex(computeMcpSchemaHash(pinned));
  for (let i = 0; i < 1000; i++) {
    const shuffled = [...pinned];
    // Fisher-Yates
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    assert.equal(toHex(computeMcpSchemaHash(shuffled)), baseline, `shuffle #${i} drift`);
  }
});
