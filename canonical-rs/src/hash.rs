//! SHA-256 and domain-separated hashing per CE v1.3 §7 — parity with `hash.ts`.
//!
//! All canonical hashes are computed as:
//!
//!   hash = SHA256(domain_tag_ascii_bytes || canonical_bytes)
//!
//! where `domain_tag_ascii_bytes` is the ASCII literal without null terminator.

use crate::domains::is_ascii_domain_tag;
use crate::errors::{CanonicalError, Result};

/// Raw SHA-256 over the given bytes. Returns a 32-byte digest.
pub use crate::sha256::sha256;

/// Domain-separated SHA-256 per CE §7: `SHA256(domain_tag || payload)`.
/// `domain` MUST be an ASCII literal; non-ASCII tags are rejected.
pub fn domain_hash(domain: &str, payload: &[u8]) -> Result<[u8; 32]> {
    if !is_ascii_domain_tag(domain) {
        return Err(CanonicalError::encoding(
            "DOMAIN_TAG_NONCANONICAL",
            format!("domain tag must be ASCII, got {domain:?}"),
        ));
    }
    let mut combined = Vec::with_capacity(domain.len() + payload.len());
    combined.extend_from_slice(domain.as_bytes());
    combined.extend_from_slice(payload);
    Ok(sha256(&combined))
}

/// Concatenate multiple byte slices into a single buffer.
pub fn concat_bytes(parts: &[&[u8]]) -> Vec<u8> {
    let total: usize = parts.iter().map(|p| p.len()).sum();
    let mut out = Vec::with_capacity(total);
    for p in parts {
        out.extend_from_slice(p);
    }
    out
}
