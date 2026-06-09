/**
 * MCP schema-hash construction per CAL Execution Spec §4.4.1.
 *
 *   MCP_SCHEMA_V1_TOOLSET := canonical_json(sorted_lex(tool_names))
 *   MCP_SCHEMA_HASH       := SHA256("PARADIGM_TERRA_MCP_V1" || MCP_SCHEMA_V1_TOOLSET)
 *
 * The function is order-independent (input is sorted), rejects duplicates,
 * non-ASCII names, empty tool names, and the empty set. Tool names MUST match
 * /^[A-Za-z0-9_]+$/ — the MCP SDK's own constraint and the protocol's
 * ASCII-only identifier rule (Execution Spec v1 §9.1).
 */

import { DOMAIN_TAGS } from "./domains.js";
import { CanonicalEncodingError } from "./errors.js";
import { domainHash } from "./hash.js";
import { canonicalizeValue } from "./jcs.js";

const NAME_RE = /^[A-Za-z0-9_]+$/;

/** Sort + validate tool names. Returns the canonical sorted array. */
export function canonicalizeMcpToolNames(toolNames: readonly string[]): string[] {
  if (toolNames.length === 0) {
    throw new CanonicalEncodingError("MCP_TOOLSET_EMPTY", "tool name set must be non-empty");
  }
  for (const name of toolNames) {
    if (typeof name !== "string") {
      throw new CanonicalEncodingError("MCP_TOOL_NAME_NONSTRING", `tool name must be a string, got ${typeof name}`);
    }
    if (name.length === 0) {
      throw new CanonicalEncodingError("MCP_TOOL_NAME_EMPTY", "tool name must be non-empty");
    }
    if (!NAME_RE.test(name)) {
      throw new CanonicalEncodingError("MCP_TOOL_NAME_NONCANONICAL", `tool name ${JSON.stringify(name)} must match /^[A-Za-z0-9_]+$/ (ASCII identifier per Execution Spec §9.1)`);
    }
  }
  const sorted = [...toolNames].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      throw new CanonicalEncodingError("MCP_TOOL_NAME_DUPLICATE", `duplicate tool name ${JSON.stringify(sorted[i])}`);
    }
  }
  return sorted;
}

/**
 * Build the canonical-JSON byte payload that gets hashed.
 * Exposed for transparency / debugging — callers normally use computeMcpSchemaHash.
 */
export function mcpSchemaToolsetBytes(toolNames: readonly string[]): Uint8Array {
  const sorted = canonicalizeMcpToolNames(toolNames);
  return canonicalizeValue(sorted);
}

/**
 * MCP_SCHEMA_HASH per CAL Spec §4.4.1. Returns a 32-byte digest.
 */
export function computeMcpSchemaHash(toolNames: readonly string[]): Uint8Array {
  const payload = mcpSchemaToolsetBytes(toolNames);
  return domainHash(DOMAIN_TAGS.MCP_V1, payload);
}
