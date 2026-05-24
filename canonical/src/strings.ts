/**
 * UTF-8 string handling per CE v1.3 §3.2.
 *
 * - Only valid UTF-8.
 * - NFC normalization per Unicode Standard Annex #15.
 * - Unicode version pinned to 15.1; this implementation relies on the host
 *   JavaScript engine's ICU. Node 22+ ships ICU 73+ (Unicode 15.1). At module
 *   load we sanity-check a known NFC fixture and throw if the host fails.
 * - BOM forbidden.
 * - Byte-wise comparison after NFC normalization.
 * - UTF-16 surrogate pairs (\uD800–\uDFFF) forbidden in canonical JSON output
 *   (enforced by jcs.ts §4.2).
 */

import { CanonicalEncodingError, NoncanonicalEventError } from "./errors.js";
import { isAssignedCodePoint } from "./unicodeAssigned.js";

const UTF8_ENCODER = new TextEncoder();

/**
 * CE v1.3 §3.2 domain restriction: a canonical string MUST contain only code
 * points assigned as of Unicode 15.1. This keeps NFC identical across the
 * TS/Rust/Go backends despite their differing Unicode versions (by the Unicode
 * Normalization Stability Policy). Throws on the first unassigned scalar.
 */
export function assertAssigned(s: string): void {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (!isAssignedCodePoint(cp)) {
      throw new NoncanonicalEventError(
        "UTF8_UNASSIGNED_CODEPOINT",
        `code point U+${cp.toString(16).toUpperCase().padStart(4, "0")} is not assigned as of Unicode 15.1`,
      );
    }
  }
}
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/**
 * NFC-normalize a string and return the UTF-8 bytes.
 *
 * Throws NoncanonicalEventError if the input contains a BOM (U+FEFF) at the
 * start, or if it contains lone surrogates that survive normalization (which
 * indicates malformed input from a non-UTF-8 source).
 */
export function utf8NfcBytes(s: string): Uint8Array {
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) {
    throw new NoncanonicalEventError("UTF8_BOM_FORBIDDEN", "BOM at start of string is forbidden");
  }
  assertAssigned(s);
  const normalized = s.normalize("NFC");
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      // Check if part of a valid surrogate pair
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < normalized.length) {
        const next = normalized.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++; // valid pair, skip low surrogate
          continue;
        }
      }
      throw new NoncanonicalEventError(
        "UTF8_LONE_SURROGATE",
        `lone UTF-16 surrogate U+${code.toString(16).toUpperCase()} at position ${i}`,
      );
    }
  }
  return UTF8_ENCODER.encode(normalized);
}

/**
 * Compare two strings byte-wise after NFC normalization.
 * Returns negative / zero / positive like Array.prototype.sort comparator.
 */
export function compareNfc(a: string, b: string): number {
  const ab = utf8NfcBytes(a);
  const bb = utf8NfcBytes(b);
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = ab[i]!;
    const bv = bb[i]!;
    if (av !== bv) return av - bv;
  }
  return ab.length - bb.length;
}

/**
 * Decode UTF-8 bytes back to a JS string (strict — throws on invalid UTF-8).
 * Used by tests and diagnostic tooling, not on the canonical hot path.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (err) {
    throw new CanonicalEncodingError("UTF8_INVALID", `invalid UTF-8 sequence: ${(err as Error).message}`);
  }
}

/**
 * Sanity check: verify that the host JS engine implements NFC.
 * "e + combining acute" (U+0065 U+0301) MUST normalize to U+00E9.
 * If this fails, the host does not provide Unicode normalization and the
 * implementation cannot proceed deterministically.
 */
function assertNfcAvailable(): void {
  const composed = "é".normalize("NFC");
  if (composed !== "é") {
    throw new CanonicalEncodingError(
      "NFC_UNAVAILABLE",
      `host JS engine NFC normalization is broken or absent (got ${JSON.stringify(composed)})`,
    );
  }
}

assertNfcAvailable();
