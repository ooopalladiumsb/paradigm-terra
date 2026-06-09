//! Contract B — `TC_V2_TONPROOF_VERIFY_V1` (owner authentication, ton-proof-item-v2).
//!
//! LITTLE-endian length/timestamp, NO type discriminator, NESTED sha256. This module
//! owns its own field encoders. It shares NO serialization/endian/hash-pipeline helper
//! with `sign_data.rs` — see docs/spec/tc-v2-contract-boundaries.md. Note that
//! `encode_domain_length` / `encode_timestamp` here are little-endian, while Contract A's
//! are big-endian: this difference is exactly why the two must never be unified.

use crate::sha256::sha256;

const PROOF_PREFIX: &[u8] = b"ton-proof-item-v2/";
const OUTER_PREFIX: &[u8] = b"ton-connect";

pub struct TonProofInput<'a> {
    pub workchain: i32,
    pub address_hash: [u8; 32],
    pub domain: &'a str,
    pub timestamp: u64,
    /// The dApp nonce, signed as its LITERAL string bytes (NOT base64-decoded).
    pub proof_payload: &'a str,
}

/// Build the Contract B message and return its (nested) sha256 digest.
pub fn ton_proof_digest(input: &TonProofInput) -> [u8; 32] {
    let domain = input.domain.as_bytes();

    let mut inner = Vec::new();
    inner.extend_from_slice(PROOF_PREFIX);
    inner.extend_from_slice(&encode_workchain(input.workchain));
    inner.extend_from_slice(&input.address_hash);
    inner.extend_from_slice(&encode_domain_length(domain.len() as u32));
    inner.extend_from_slice(domain);
    inner.extend_from_slice(&encode_timestamp(input.timestamp));
    inner.extend_from_slice(input.proof_payload.as_bytes());

    let inner_hash = sha256(&inner);

    let mut outer = Vec::new();
    outer.extend_from_slice(&[0xff, 0xff]);
    outer.extend_from_slice(OUTER_PREFIX);
    outer.extend_from_slice(&inner_hash);
    sha256(&outer)
}

// --- Contract B field encoders. workchain BE; domain_len/timestamp LITTLE-endian.
//     NOT shared with Contract A. ---
fn encode_workchain(wc: i32) -> [u8; 4] {
    wc.to_be_bytes()
}
fn encode_domain_length(n: u32) -> [u8; 4] {
    n.to_le_bytes()
}
fn encode_timestamp(ts: u64) -> [u8; 8] {
    ts.to_le_bytes()
}
