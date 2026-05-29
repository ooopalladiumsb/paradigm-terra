#!/usr/bin/env node
// Generates tools/mcp/vectors.json — cross-language conformance vectors
// for the MCP_SCHEMA_HASH construction (CAL Spec §4.4.1).
//
// Invariants exercised:
//   - same tools / different input order      → same hash (order-independence)
//   - one renamed tool                        → different hash
//   - one added tool                          → different hash
//   - non-ASCII / invalid name                → reject (MCP_TOOL_NAME_NONCANONICAL)
//   - empty name                              → reject (MCP_TOOL_NAME_EMPTY)
//   - duplicate name                          → reject (MCP_TOOL_NAME_DUPLICATE)
//   - empty toolset                           → reject (MCP_TOOLSET_EMPTY)
//   - live @ton/mcp@0.1.15-alpha.16           → protocol-pinned hash

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeMcpSchemaHash,
  mcpSchemaToolsetBytes,
  CanonicalEncodingError,
} from "../../canonical/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(__dirname, "vectors.json");
const TOOLS_JSON_PATH = resolve(__dirname, "mcp-schema-v1-tools.json");
const HASH_PATH = resolve(__dirname, "mcp-schema-v1.hash");

const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

function vectorOk(id, description, toolNames) {
  const bytes = mcpSchemaToolsetBytes(toolNames);
  const hash = computeMcpSchemaHash(toolNames);
  return {
    id,
    description,
    input: { tool_names: toolNames },
    expect: {
      kind: "ok",
      canonical_bytes_utf8: Buffer.from(bytes).toString("utf8"),
      canonical_bytes_sha256_hex: sha256Hex(bytes),
      mcp_schema_hash_hex: toHex(hash),
    },
  };
}

function vectorErr(id, description, toolNames, expectedCode) {
  let actualCode = null;
  let message = null;
  try {
    computeMcpSchemaHash(toolNames);
  } catch (e) {
    if (e instanceof CanonicalEncodingError) {
      actualCode = e.code;
      message = e.message;
    } else throw e;
  }
  if (actualCode !== expectedCode) {
    throw new Error(`vector ${id}: expected ${expectedCode}, got ${actualCode} (${message})`);
  }
  return {
    id,
    description,
    input: { tool_names: toolNames },
    expect: { kind: "error", error_code: expectedCode },
  };
}

async function main() {
  const pinned = JSON.parse(await readFile(TOOLS_JSON_PATH, "utf8"));

  const sortedMin = ["a_tool", "b_tool"];
  const reversedMin = ["b_tool", "a_tool"];
  const renamedMin = ["c_tool", "b_tool"];
  const addedMin = ["a_tool", "b_tool", "c_tool"];

  const vectors = [
    vectorOk("minimal_sorted",
      "two ASCII tool names, already sorted — baseline",
      sortedMin),
    vectorOk("minimal_reversed",
      "same set as minimal_sorted but input is reverse-sorted — hash MUST match minimal_sorted",
      reversedMin),
    vectorOk("minimal_renamed",
      "one tool renamed (a_tool → c_tool) — hash MUST differ from minimal_sorted",
      renamedMin),
    vectorOk("minimal_added",
      "one tool added on top of minimal_sorted — hash MUST differ from minimal_sorted",
      addedMin),
    vectorErr("reject_nonascii_cyrillic",
      "tool name contains a non-ASCII codepoint (Cyrillic) — MUST reject",
      ["get_кошелёк"],
      "MCP_TOOL_NAME_NONCANONICAL"),
    vectorErr("reject_nonascii_emoji",
      "tool name contains an emoji — MUST reject",
      ["get_🔥"],
      "MCP_TOOL_NAME_NONCANONICAL"),
    vectorErr("reject_hyphen",
      "tool name uses '-' (allowed in some identifier styles but NOT in [A-Za-z0-9_]) — MUST reject",
      ["get-wallet"],
      "MCP_TOOL_NAME_NONCANONICAL"),
    vectorErr("reject_empty_name",
      "tool name is the empty string — MUST reject",
      ["valid_tool", ""],
      "MCP_TOOL_NAME_EMPTY"),
    vectorErr("reject_duplicate",
      "tool name appears twice in the input — MUST reject",
      ["get_balance", "get_wallet", "get_balance"],
      "MCP_TOOL_NAME_DUPLICATE"),
    vectorErr("reject_empty_set",
      "empty toolset — MUST reject (degenerate SCHEMA_MISMATCH case)",
      [],
      "MCP_TOOLSET_EMPTY"),
    vectorOk("pinned_ton_mcp_alpha_16",
      "live @ton/mcp@0.1.15-alpha.16 toolset (40 tools) — protocol-pinned vector",
      pinned),
  ];

  const byId = Object.fromEntries(vectors.map((v) => [v.id, v]));
  const hashOf = (id) => byId[id].expect.mcp_schema_hash_hex;

  if (hashOf("minimal_sorted") !== hashOf("minimal_reversed")) {
    throw new Error("order-independence broken");
  }
  if (hashOf("minimal_renamed") === hashOf("minimal_sorted")) {
    throw new Error("rename did not change hash");
  }
  if (hashOf("minimal_added") === hashOf("minimal_sorted")) {
    throw new Error("addition did not change hash");
  }
  if (hashOf("minimal_renamed") === hashOf("minimal_added")) {
    throw new Error("rename collided with addition (spurious)");
  }

  const pinnedExpected = (await readFile(HASH_PATH, "utf8")).trim();
  if (hashOf("pinned_ton_mcp_alpha_16") !== pinnedExpected) {
    throw new Error(`pinned vector drift: artifact=${pinnedExpected} vector=${hashOf("pinned_ton_mcp_alpha_16")}`);
  }

  const out = {
    meta: {
      package: "@paradigm-terra/canonical",
      function: "computeMcpSchemaHash",
      spec_basis: "CAL Execution Spec §4.4.1 / §4.4.2",
      pinned_upstream: "@ton/mcp@0.1.15-alpha.16",
      generated_at: new Date().toISOString(),
      status: "NORMATIVE — Rust + Go parity verified 2026-05-29 (canonical-rs tests/mcp.rs, canonical-go mcp_test.go); all 11 vectors byte-identical across TS / Rust / Go",
    },
    vectors,
  };
  await writeFile(VECTORS_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${vectors.length} vectors to ${VECTORS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
