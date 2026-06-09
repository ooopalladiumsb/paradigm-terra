//! Rust reference for the two TC v2 owner-signature contracts.
//!
//! - Contract A — [`sign_data`] — `TC_V2_SIGNDATA_VERIFY_V1`
//! - Contract B — [`ton_proof`] — `TC_V2_TONPROOF_VERIFY_V1`
//!
//! This crate computes the signed-message **digest** for each contract and is verified
//! byte-for-byte against the TypeScript reference golden vectors
//! (`../spec/vectors/tc_v2_sig_verify_v1/`) by `tests/digest_parity.rs`. It deliberately
//! does NOT depend on an Ed25519 implementation: the digest axis is the part that is ours
//! and that must agree across languages; the verdict axis (ed25519) is covered by TS (Node)
//! and Go (std `crypto/ed25519`). See `docs/spec/tc-v2-sig-verify-v1.md`.
//!
//! There is intentionally NO universal verifier/serializer facade spanning the two
//! contracts (`docs/spec/tc-v2-contract-boundaries.md`): callers select the contract module
//! explicitly. Each module owns its own endianness and envelope.

pub mod sha256;
pub mod sign_data;
pub mod ton_proof;
pub mod util;
