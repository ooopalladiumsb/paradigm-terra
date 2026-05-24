//! Integer encoding per CE v1.3 §3.1 — parity with `integers.ts`.
//!
//! - int256 / uint256 → 32 bytes big-endian
//! - uint64 → 8 bytes big-endian
//! - uint16 → 2 bytes big-endian
//! - uint8  → 1 byte
//!
//! int256 uses two's complement; negative values fill the high bytes with 0xff.
//!
//! 256-bit values exceed `u128`, so int256/uint256 take a decimal string and
//! convert directly into 32 big-endian bytes (base-256 long multiplication).
//! This avoids a bignum dependency while exactly matching the TS bigint path:
//! every input produced by the validated JCS/decimal grammar round-trips
//! identically.

use crate::errors::{CanonicalError, Result};

/// 2^255 as 32 big-endian bytes — the boundary used for int256 range checks.
const TWO_POW_255: [u8; 32] = {
    let mut b = [0u8; 32];
    b[0] = 0x80;
    b
};

/// Convert a non-negative decimal string into 32 big-endian bytes.
/// Errors (`*_OUT_OF_RANGE`) if the value exceeds 2^256 - 1 or is malformed.
fn dec_to_be32(digits: &str, code: &'static str) -> Result<[u8; 32]> {
    if digits.is_empty() {
        return Err(CanonicalError::encoding(code, "empty decimal string"));
    }
    let mut out = [0u8; 32];
    for ch in digits.chars() {
        let digit = ch
            .to_digit(10)
            .ok_or_else(|| CanonicalError::encoding(code, format!("invalid decimal digit {ch:?}")))?;
        // out = out * 10 + digit
        let mut carry = digit as u16;
        for byte in out.iter_mut().rev() {
            let v = (*byte as u16) * 10 + carry;
            *byte = (v & 0xff) as u8;
            carry = v >> 8;
        }
        if carry != 0 {
            return Err(CanonicalError::encoding(code, "value exceeds 2^256-1"));
        }
    }
    Ok(out)
}

/// Two's complement negation of a 32-byte big-endian magnitude: `(~b) + 1`.
fn twos_complement(b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut carry = 1u16;
    for i in (0..32).rev() {
        let v = ((b[i] ^  0xff) as u16) + carry;
        out[i] = (v & 0xff) as u8;
        carry = v >> 8;
    }
    out
}

// ----- uint8 / uint16 / uint64 -----

pub fn encode_uint8(value: u8) -> [u8; 1] {
    [value]
}

pub fn encode_uint16(value: u16) -> [u8; 2] {
    value.to_be_bytes()
}

pub fn encode_uint64(value: u64) -> [u8; 8] {
    value.to_be_bytes()
}

// ----- uint256 -----

/// Encode a non-negative decimal string as uint256 (32 bytes big-endian).
pub fn encode_uint256_dec(value: &str) -> Result<[u8; 32]> {
    if value.starts_with('-') {
        return Err(CanonicalError::encoding(
            "UINT256_OUT_OF_RANGE",
            format!("uint256 must be 0..2^256-1, got {value}"),
        ));
    }
    dec_to_be32(value, "UINT256_OUT_OF_RANGE")
}

// ----- int256 (two's complement) -----

/// Encode a signed decimal string as int256 (32 bytes big-endian, two's
/// complement). Range is [-2^255, 2^255-1].
pub fn encode_int256_dec(value: &str) -> Result<[u8; 32]> {
    let (negative, digits) = match value.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, value),
    };
    let magnitude = dec_to_be32(digits, "INT256_OUT_OF_RANGE")?;
    if negative {
        // magnitude must be <= 2^255
        if cmp_be(&magnitude, &TWO_POW_255) == std::cmp::Ordering::Greater {
            return Err(CanonicalError::encoding(
                "INT256_OUT_OF_RANGE",
                format!("int256 out of range, got {value}"),
            ));
        }
        Ok(twos_complement(&magnitude))
    } else {
        // magnitude must be <= 2^255 - 1, i.e. top bit clear
        if magnitude[0] & 0x80 != 0 {
            return Err(CanonicalError::encoding(
                "INT256_OUT_OF_RANGE",
                format!("int256 out of range, got {value}"),
            ));
        }
        Ok(magnitude)
    }
}

fn cmp_be(a: &[u8; 32], b: &[u8; 32]) -> std::cmp::Ordering {
    a.cmp(b)
}

// ----- hex helpers (lowercase, fixed width, optional 0x prefix) -----

/// Lowercase fixed-width hex, no prefix.
pub fn to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

/// Lowercase fixed-width hex with a `0x` prefix.
pub fn to_hex_prefixed(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

/// Decode hex (with or without a `0x`/`0X` prefix) into bytes.
pub fn from_hex(s: &str) -> Result<Vec<u8>> {
    let stripped = s
        .strip_prefix("0x")
        .or_else(|| s.strip_prefix("0X"))
        .unwrap_or(s);
    if stripped.len() % 2 != 0 {
        return Err(CanonicalError::encoding(
            "HEX_ODD_LENGTH",
            format!("hex string must have even length, got {}", stripped.len()),
        ));
    }
    hex::decode(stripped)
        .map_err(|e| CanonicalError::encoding("HEX_INVALID_CHAR", format!("invalid hex: {e}")))
}
