/**
 * SHA-256 and domain-separated hashing per CE v1.3 §7.
 *
 * All canonical hashes are computed as:
 *   hash = SHA256(domain_tag_ascii_bytes || canonical_bytes)
 *
 * `domain_tag_ascii_bytes` is the ASCII literal without null terminator.
 */

import { createHash } from "node:crypto";
import { isAsciiDomainTag } from "./domains.js";
import { CanonicalEncodingError } from "./errors.js";

const ASCII = new TextEncoder();

/** Raw SHA-256 over the given bytes. Returns 32-byte digest. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = createHash("sha256");
  h.update(bytes);
  return new Uint8Array(h.digest());
}

/**
 * Domain-separated SHA-256 per CE §7.
 *
 *   hash = SHA256(domain_tag || payload)
 *
 * `domain` MUST be an ASCII literal; non-ASCII tags are rejected.
 */
export function domainHash(domain: string, payload: Uint8Array): Uint8Array {
  if (!isAsciiDomainTag(domain)) {
    throw new CanonicalEncodingError("DOMAIN_TAG_NONCANONICAL", `domain tag must be ASCII, got ${JSON.stringify(domain)}`);
  }
  const tagBytes = ASCII.encode(domain);
  const combined = new Uint8Array(tagBytes.length + payload.length);
  combined.set(tagBytes, 0);
  combined.set(payload, tagBytes.length);
  return sha256(combined);
}

/** Concatenate multiple Uint8Arrays into a single buffer. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
