//! Contract A — `TC_V2_SIGNDATA_VERIFY_V1` (owner signature, signData).
//!
//! Big-endian length/timestamp, `txt`/`bin` type discriminator, SINGLE sha256.
//! This module owns its own field encoders (`encode_*` below). It shares NO
//! serialization/endian/hash-pipeline helper with `ton_proof.rs` — see the
//! prohibition in docs/spec/tc-v2-contract-boundaries.md. The conscious
//! duplication of `encode_domain_length` / `encode_timestamp` across the two
//! modules is the intended design, not debt.

use crate::sha256::sha256;
use crate::util::b64_decode;

const SCHEMA_PREFIX: &[u8] = b"ton-connect/sign-data/";

/// Owner-signature payload, per TC v2 `signData` type.
pub enum Payload<'a> {
    /// Signed as opaque UTF-8 bytes of the string.
    Text(&'a str),
    /// `bytes` field as standard base64; signed as the decoded bytes.
    Binary(&'a str),
}

pub struct SignDataInput<'a> {
    pub workchain: i32,
    pub address_hash: [u8; 32],
    pub domain: &'a str,
    pub timestamp: u64,
    pub payload: Payload<'a>,
}

/// Build the Contract A message and return its sha256 digest (the bytes ed25519 signs).
pub fn sign_data_digest(input: &SignDataInput) -> [u8; 32] {
    let (tag, payload): (&[u8], Vec<u8>) = match &input.payload {
        Payload::Text(t) => (b"txt", t.as_bytes().to_vec()),
        Payload::Binary(b64) => (b"bin", b64_decode(b64)),
    };
    let domain = input.domain.as_bytes();

    let mut m = Vec::new();
    m.extend_from_slice(&[0xff, 0xff]);
    m.extend_from_slice(SCHEMA_PREFIX);
    m.extend_from_slice(&encode_workchain(input.workchain));
    m.extend_from_slice(&input.address_hash);
    m.extend_from_slice(&encode_domain_length(domain.len() as u32));
    m.extend_from_slice(domain);
    m.extend_from_slice(&encode_timestamp(input.timestamp));
    m.extend_from_slice(tag);
    m.extend_from_slice(&encode_payload_length(payload.len() as u32));
    m.extend_from_slice(&payload);
    sha256(&m)
}

// --- Contract A field encoders (big-endian). NOT shared with Contract B. ---
fn encode_workchain(wc: i32) -> [u8; 4] {
    wc.to_be_bytes()
}
fn encode_domain_length(n: u32) -> [u8; 4] {
    n.to_be_bytes()
}
fn encode_timestamp(ts: u64) -> [u8; 8] {
    ts.to_be_bytes()
}
fn encode_payload_length(n: u32) -> [u8; 4] {
    n.to_be_bytes()
}
