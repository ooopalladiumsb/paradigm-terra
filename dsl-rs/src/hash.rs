//! DSL_HASH (mirrors `hash.ts`).
//!
//!   DSL_HASH = SHA256("PARADIGM_TERRA_DSL_V1.x" || canonical_json(expr))
//!
//! Canonicalization, domain separation and SHA-256 are reused from canonical-rs,
//! so DSL hashes are byte-identical to the encoding spec's restricted-JCS profile.

use paradigm_terra_canonical::domains::{DSL_V1_1, DSL_V1_2};
use paradigm_terra_canonical::hash::domain_hash;
use paradigm_terra_canonical::jcs::{canonicalize_value, JcsValue};
use paradigm_terra_canonical::Result as CanonResult;

use crate::ast::Version;

pub fn dsl_domain_tag(version: Version) -> &'static str {
    match version {
        Version::V11 => DSL_V1_1,
        Version::V12 => DSL_V1_2,
    }
}

pub fn dsl_hash(expr: &JcsValue, version: Version) -> CanonResult<[u8; 32]> {
    let payload = canonicalize_value(expr)?;
    domain_hash(dsl_domain_tag(version), &payload)
}
