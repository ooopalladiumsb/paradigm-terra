//! TON address handling per CE v1.3 §3.3 — parity with `addresses.ts`.
//!
//! Canonical format: `<workchain>:<64 hex chars raw>`
//!   - workchain ∈ [-128, 127] (int8)
//!   - 64 lowercase hex chars, no `0x` prefix
//!   - anything else (bounceable, non-bounceable, base64, user-friendly) is
//!     forbidden.

use crate::errors::{CanonicalError, Result};
use crate::integers::{from_hex, to_hex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAddress {
    pub workchain: i32,
    pub hash: [u8; 32],
}

/// Parse a canonical raw TON address. Rejects uppercase hex, base64, missing
/// colon, wrong hash length, or workchain outside the int8 range.
pub fn parse_address(addr: &str) -> Result<ParsedAddress> {
    let noncanonical = || {
        CanonicalError::encoding(
            "ADDRESS_NONCANONICAL",
            format!("address {addr:?} is not canonical raw <workchain>:<64-hex-lowercase>"),
        )
    };

    let (wc_str, hex_str) = addr.split_once(':').ok_or_else(noncanonical)?;

    // workchain: optional '-' then 1..=4 ASCII digits.
    let digits = wc_str.strip_prefix('-').unwrap_or(wc_str);
    if digits.is_empty()
        || digits.len() > 4
        || !digits.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(noncanonical());
    }

    // hash: exactly 64 lowercase hex chars.
    if hex_str.len() != 64 || !hex_str.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(noncanonical());
    }

    let workchain: i32 = wc_str
        .parse()
        .map_err(|_| noncanonical())?;
    if !(-128..=127).contains(&workchain) {
        return Err(CanonicalError::encoding(
            "ADDRESS_WORKCHAIN_RANGE",
            format!("workchain {workchain} outside int8 range [-128, 127]"),
        ));
    }

    let bytes = from_hex(hex_str)?;
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&bytes);
    Ok(ParsedAddress { workchain, hash })
}

/// Render a parsed address back to its canonical raw form.
pub fn format_address(parsed: &ParsedAddress) -> String {
    format!("{}:{}", parsed.workchain, to_hex(&parsed.hash))
}

/// Validate a raw TON address string.
pub fn is_canonical_address(addr: &str) -> bool {
    parse_address(addr).is_ok()
}

/// Canonical byte form of an address for hashing in compound structures:
/// `int8(workchain) || 32 bytes hash`. The `PARADIGM_TERRA_ADDRESS_V1` domain
/// prefix is applied at hash time, not here.
pub fn address_to_bytes(addr: &str) -> Result<Vec<u8>> {
    let parsed = parse_address(addr)?;
    address_to_bytes_parsed(&parsed)
}

pub fn address_to_bytes_parsed(parsed: &ParsedAddress) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(33);
    // int8 → unsigned byte (two's complement in one byte)
    out.push((parsed.workchain as i8) as u8);
    out.extend_from_slice(&parsed.hash);
    Ok(out)
}
