/**
 * @paradigm-terra/canonical — reference implementation of
 * Canonical Encoding Specification v1.3 (Consensus-Freeze) with v0.10.0-draft additions.
 *
 * Public surface:
 *   - integers:  int256 / uint256 / uint64 / uint16 / uint8 BE encoding
 *   - strings:   UTF-8 NFC normalization
 *   - addresses: canonical raw TON address parsing
 *   - jcs:       restricted JCS profile (integers only, no dup keys, no surrogates)
 *   - hash:      SHA-256 with domain separation
 *   - framing:   [type_tag:u16][version:u16][length:u32][payload]
 *   - merkle:    binary balanced Merkle (CE §6, CAL Spec §7.3)
 *   - domains:   tag registry (CE §7.1 + v0.10.0-draft)
 *   - mcp:       MCP schema-hash construction (CAL Spec §4.4.1)
 */

export * from "./domains.js";
export * from "./errors.js";
export * from "./integers.js";
export * from "./strings.js";
export * from "./addresses.js";
export * from "./jcs.js";
export * from "./hash.js";
export * from "./framing.js";
export * from "./merkle.js";
export * from "./mcp.js";
