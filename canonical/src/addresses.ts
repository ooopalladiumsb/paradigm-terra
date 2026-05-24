/**
 * TON address handling per CE v1.3 §3.3.
 *
 * Canonical format: <workchain>:<64 hex chars raw>
 *   - workchain ∈ [-128, 127] (int8)
 *   - 64 lowercase hex chars, no '0x' prefix
 *   - Anything else (bounceable, non-bounceable, base64, user-friendly) is forbidden.
 */

import { CanonicalEncodingError } from "./errors.js";
import { fromHex, toHex } from "./integers.js";

const RAW_RE = /^(-?\d{1,4}):([0-9a-f]{64})$/;

export interface ParsedAddress {
  readonly workchain: number;
  readonly hash: Uint8Array; // exactly 32 bytes
}

/**
 * Parse a canonical raw TON address. Throws on any deviation:
 *   - uppercase hex,
 *   - base64 (bounceable/non-bounceable),
 *   - missing colon,
 *   - hash length ≠ 64 hex chars,
 *   - workchain outside int8 range.
 */
export function parseAddress(addr: string): ParsedAddress {
  const m = RAW_RE.exec(addr);
  if (!m) {
    throw new CanonicalEncodingError(
      "ADDRESS_NONCANONICAL",
      `address ${JSON.stringify(addr)} is not canonical raw <workchain>:<64-hex-lowercase>`,
    );
  }
  const wcStr = m[1]!;
  const hexStr = m[2]!;
  const workchain = Number.parseInt(wcStr, 10);
  if (!Number.isInteger(workchain) || workchain < -128 || workchain > 127) {
    throw new CanonicalEncodingError(
      "ADDRESS_WORKCHAIN_RANGE",
      `workchain ${workchain} outside int8 range [-128, 127]`,
    );
  }
  return { workchain, hash: fromHex(hexStr) };
}

/**
 * Render a parsed address back to its canonical raw form.
 */
export function formatAddress(parsed: ParsedAddress): string {
  if (parsed.hash.length !== 32) {
    throw new CanonicalEncodingError(
      "ADDRESS_BAD_HASH",
      `address hash must be 32 bytes, got ${parsed.hash.length}`,
    );
  }
  return `${parsed.workchain}:${toHex(parsed.hash)}`;
}

/**
 * Validate a raw TON address string without allocating beyond regex internals.
 */
export function isCanonicalAddress(addr: string): boolean {
  try {
    parseAddress(addr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical byte form of an address for hashing in compound structures:
 *   int8(workchain) || 32 bytes hash.
 * Equivalent to encoding under domain tag PARADIGM_TERRA_ADDRESS_V1 (CE §7.1)
 * — the prefix is applied at hash-time, not here.
 */
export function addressToBytes(addr: string | ParsedAddress): Uint8Array {
  const parsed = typeof addr === "string" ? parseAddress(addr) : addr;
  const out = new Uint8Array(1 + 32);
  // int8 → unsigned byte (two's complement in one byte)
  out[0] = parsed.workchain < 0 ? parsed.workchain + 256 : parsed.workchain;
  out.set(parsed.hash, 1);
  return out;
}
