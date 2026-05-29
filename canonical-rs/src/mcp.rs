//! MCP schema-hash construction per CAL Execution Spec §4.4.1 — Rust parity with `mcp.ts`.
//!
//!   MCP_SCHEMA_V1_TOOLSET := canonical_json(sorted_lex(tool_names))
//!   MCP_SCHEMA_HASH       := SHA256("PARADIGM_TERRA_MCP_V1" || MCP_SCHEMA_V1_TOOLSET)
//!
//! Tool names MUST match `[A-Za-z0-9_]+` (Execution Spec v1 §9.1 ASCII identifiers).
//! The function rejects: empty set, empty name, non-conforming name, duplicates.

use crate::domains::MCP_V1;
use crate::errors::{CanonicalError, Result};
use crate::hash::domain_hash;
use crate::jcs::{canonicalize_value, JcsValue};

fn is_valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_'))
}

/// Validate + sort. Returns the canonical sorted name vector (a new allocation).
pub fn canonicalize_mcp_tool_names(tool_names: &[String]) -> Result<Vec<String>> {
    if tool_names.is_empty() {
        return Err(CanonicalError::encoding(
            "MCP_TOOLSET_EMPTY",
            "tool name set must be non-empty",
        ));
    }
    for name in tool_names {
        if name.is_empty() {
            return Err(CanonicalError::encoding(
                "MCP_TOOL_NAME_EMPTY",
                "tool name must be non-empty",
            ));
        }
        if !is_valid_name(name) {
            return Err(CanonicalError::encoding(
                "MCP_TOOL_NAME_NONCANONICAL",
                format!(
                    "tool name {name:?} must match /^[A-Za-z0-9_]+$/ (ASCII identifier per Execution Spec §9.1)"
                ),
            ));
        }
    }
    let mut sorted: Vec<String> = tool_names.to_vec();
    sorted.sort();
    for w in sorted.windows(2) {
        if w[0] == w[1] {
            return Err(CanonicalError::encoding(
                "MCP_TOOL_NAME_DUPLICATE",
                format!("duplicate tool name {:?}", w[0]),
            ));
        }
    }
    Ok(sorted)
}

/// Build the canonical-JSON byte payload that gets hashed.
pub fn mcp_schema_toolset_bytes(tool_names: &[String]) -> Result<Vec<u8>> {
    let sorted = canonicalize_mcp_tool_names(tool_names)?;
    let value = JcsValue::Array(sorted.into_iter().map(JcsValue::Str).collect());
    canonicalize_value(&value)
}

/// MCP_SCHEMA_HASH per CAL Spec §4.4.1. Returns the 32-byte digest.
pub fn compute_mcp_schema_hash(tool_names: &[String]) -> Result<[u8; 32]> {
    let payload = mcp_schema_toolset_bytes(tool_names)?;
    domain_hash(MCP_V1, &payload)
}
