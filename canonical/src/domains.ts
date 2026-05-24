/**
 * Registry of domain tags from Canonical Encoding §7.1 and v0.10.0-draft additions.
 *
 * Each tag is an ASCII literal used as a prefix to the canonical byte sequence
 * before SHA-256, per CE v1.3 §7. Adding or modifying a tag requires Tier 2 amendment.
 */

export const DOMAIN_TAGS = {
  // CE v1.3 §7.1
  DSL_V1_1: "PARADIGM_TERRA_DSL_V1.1",
  MERKLE_LEAF_V1: "PARADIGM_TERRA_MERKLE_LEAF_V1",
  MERKLE_NODE_V1: "PARADIGM_TERRA_MERKLE_NODE_V1",
  STATE_V1: "PARADIGM_TERRA_STATE_V1",
  EVENT_V1: "PARADIGM_TERRA_EVENT_V1",
  EVENTCHAIN_V1: "PARADIGM_TERRA_EVENTCHAIN_V1",
  RECEIPT_V1: "PARADIGM_TERRA_RECEIPT_V1",
  CAL_V1: "PARADIGM_TERRA_CAL_V1",
  ADDRESS_V1: "PARADIGM_TERRA_ADDRESS_V1",
  // CE v1.3 §3.5 — PTRA jetton
  JETTON_TRANSFER_V1: "PARADIGM_TERRA_JETTON_TRANSFER_V1",
  PTRA_STAKE_V1: "PARADIGM_TERRA_PTRA_STAKE_V1",
  PTRA_UNSTAKE_V1: "PARADIGM_TERRA_PTRA_UNSTAKE_V1",
  PTRA_BURN_V1: "PARADIGM_TERRA_PTRA_BURN_V1",
  // CE v1.3 §VI MCP schema
  MCP_V1: "PARADIGM_TERRA_MCP_V1",
  // v0.10.0-draft additions (CAL Spec §7.3, DSL Spec §8.1)
  STATE_ROOT_V1: "PARADIGM_TERRA_STATE_ROOT_V1",
  DSL_V1_2: "PARADIGM_TERRA_DSL_V1.2",
} as const;

export type DomainTagName = keyof typeof DOMAIN_TAGS;
export type DomainTag = (typeof DOMAIN_TAGS)[DomainTagName];

/** All registered tags as raw strings. */
export const ALL_DOMAIN_TAGS: readonly string[] = Object.values(DOMAIN_TAGS);

/**
 * Validate that a domain tag is ASCII-only, has no null terminator,
 * and is non-empty. CE v1.3 §7 requires ASCII literals.
 */
export function isAsciiDomainTag(tag: string): boolean {
  if (tag.length === 0) return false;
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i);
    if (code === 0 || code > 0x7f) return false;
  }
  return true;
}

/** Compile-time invariant: every registered tag is valid ASCII. */
for (const tag of ALL_DOMAIN_TAGS) {
  if (!isAsciiDomainTag(tag)) {
    throw new Error(`Invalid domain tag in registry: ${JSON.stringify(tag)}`);
  }
}
