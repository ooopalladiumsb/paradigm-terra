//! Registry of domain tags — parity with `domains.ts`.
//!
//! Each tag is an ASCII literal prefixed to the canonical byte sequence before
//! SHA-256, per CE v1.3 §7. Adding or modifying a tag requires a Tier 2
//! amendment.

// CE v1.3 §7.1
pub const DSL_V1_1: &str = "PARADIGM_TERRA_DSL_V1.1";
pub const MERKLE_LEAF_V1: &str = "PARADIGM_TERRA_MERKLE_LEAF_V1";
pub const MERKLE_NODE_V1: &str = "PARADIGM_TERRA_MERKLE_NODE_V1";
pub const STATE_V1: &str = "PARADIGM_TERRA_STATE_V1";
pub const EVENT_V1: &str = "PARADIGM_TERRA_EVENT_V1";
pub const EVENTCHAIN_V1: &str = "PARADIGM_TERRA_EVENTCHAIN_V1";
pub const RECEIPT_V1: &str = "PARADIGM_TERRA_RECEIPT_V1";
pub const CAL_V1: &str = "PARADIGM_TERRA_CAL_V1";
pub const ADDRESS_V1: &str = "PARADIGM_TERRA_ADDRESS_V1";
// CE v1.3 §3.5 — PTRA jetton
pub const JETTON_TRANSFER_V1: &str = "PARADIGM_TERRA_JETTON_TRANSFER_V1";
pub const PTRA_STAKE_V1: &str = "PARADIGM_TERRA_PTRA_STAKE_V1";
pub const PTRA_UNSTAKE_V1: &str = "PARADIGM_TERRA_PTRA_UNSTAKE_V1";
pub const PTRA_BURN_V1: &str = "PARADIGM_TERRA_PTRA_BURN_V1";
// CE v1.3 §VI MCP schema
pub const MCP_V1: &str = "PARADIGM_TERRA_MCP_V1";
// v0.10.0-draft additions (CAL Spec §7.3, DSL Spec §8.1)
pub const STATE_ROOT_V1: &str = "PARADIGM_TERRA_STATE_ROOT_V1";
pub const DSL_V1_2: &str = "PARADIGM_TERRA_DSL_V1.2";

/// All registered tags as `(registry_name, value)` pairs. The `registry_name`
/// matches the key used in the `domain_tags_registry` golden vector.
pub const ALL_DOMAIN_TAGS: &[(&str, &str)] = &[
    ("DSL_V1_1", DSL_V1_1),
    ("MERKLE_LEAF_V1", MERKLE_LEAF_V1),
    ("MERKLE_NODE_V1", MERKLE_NODE_V1),
    ("STATE_V1", STATE_V1),
    ("EVENT_V1", EVENT_V1),
    ("EVENTCHAIN_V1", EVENTCHAIN_V1),
    ("RECEIPT_V1", RECEIPT_V1),
    ("CAL_V1", CAL_V1),
    ("ADDRESS_V1", ADDRESS_V1),
    ("JETTON_TRANSFER_V1", JETTON_TRANSFER_V1),
    ("PTRA_STAKE_V1", PTRA_STAKE_V1),
    ("PTRA_UNSTAKE_V1", PTRA_UNSTAKE_V1),
    ("PTRA_BURN_V1", PTRA_BURN_V1),
    ("MCP_V1", MCP_V1),
    ("STATE_ROOT_V1", STATE_ROOT_V1),
    ("DSL_V1_2", DSL_V1_2),
];

/// Validate that a domain tag is ASCII-only, has no null terminator, and is
/// non-empty. CE v1.3 §7 requires ASCII literals.
pub fn is_ascii_domain_tag(tag: &str) -> bool {
    if tag.is_empty() {
        return false;
    }
    tag.bytes().all(|b| b != 0 && b <= 0x7f)
}
