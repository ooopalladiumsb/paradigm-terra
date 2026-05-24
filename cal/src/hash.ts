/**
 * CAL canonical hashing (CAL Spec §2.2, §5, §8.3).
 *
 *   CANONICAL_UNSIGNED = canonical_bytes(CAL with the "signatures" key omitted)
 *   CAL_HASH       = SHA256("PARADIGM_TERRA_CAL_V1"     || CANONICAL_UNSIGNED)   (§2.2)
 *   SIGN_PAYLOAD   = CANONICAL_UNSIGNED   ← Ed25519 signs this exact byte string (§8.3)
 *   EVENT_HASH(e)  = SHA256("PARADIGM_TERRA_EVENT_V1"   || canonical_bytes(e))
 *   RECEIPT_HASH(e)= SHA256("PARADIGM_TERRA_RECEIPT_V1" || canonical_bytes(e))   (§5.1/§5.2)
 *
 * `CAL_HASH` and `SIGN_PAYLOAD` derive from the SAME byte string, so the signing
 * model and the in-flight key agree by construction. STATE_ROOT (§7.3) and the
 * event-log Merkle (CE §6.3) live in the canonical layer and are re-exported.
 */

import {
  canonicalizeValue,
  DOMAIN_TAGS,
  domainHash,
  stateRoot,
  streamTreeRoot,
} from "@paradigm-terra/canonical";
import { calError } from "./errors.js";

/** The canonical, signature-free byte string a CAL hashes and is signed over. */
export function canonicalUnsignedBytes(cal: unknown): Uint8Array {
  if (typeof cal !== "object" || cal === null || Array.isArray(cal)) throw calError("NOT_OBJECT");
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cal)) {
    if (k !== "signatures") rest[k] = v;
  }
  return canonicalizeValue(rest);
}

/** CAL_HASH — the key under which the CAL lives in `state.cal.in_flight`. */
export function calHash(cal: unknown): Uint8Array {
  return domainHash(DOMAIN_TAGS.CAL_V1, canonicalUnsignedBytes(cal));
}

/** Generic per-event hash (domain tag EVENT_V1). */
export function eventHash(event: unknown): Uint8Array {
  return domainHash(DOMAIN_TAGS.EVENT_V1, canonicalizeValue(event));
}

/** RECEIPT_HASH for a terminal event (cal.finalized / cal.failed / cal.expired). */
export function receiptHash(event: unknown): Uint8Array {
  return domainHash(DOMAIN_TAGS.RECEIPT_V1, canonicalizeValue(event));
}

// Re-export the state-root and event-log Merkle from the canonical layer; the
// CAL skeleton consumes them (e.g. for receipt state_root_before/after) rather
// than reimplementing §7.3 / CE §6.3.
export { stateRoot, streamTreeRoot };
