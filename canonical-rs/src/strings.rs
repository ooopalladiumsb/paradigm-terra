//! UTF-8 string handling per CE v1.3 §3.2 — parity with `strings.ts`.
//!
//! - Only valid UTF-8 (guaranteed by Rust's `&str`).
//! - NFC normalization per Unicode Standard Annex #15.
//! - BOM (U+FEFF) at the start is forbidden.
//! - Byte-wise comparison after NFC normalization.
//!
//! Rust `&str` cannot hold lone UTF-16 surrogates, so the surrogate checks that
//! `strings.ts` performs on its UTF-16 input are structurally unreachable here.
//!
//! NOTE on Unicode version: NFC tables come from the `unicode-normalization`
//! crate. The TS reference pins Unicode 15.1 (Node 22 ICU 73+). For full
//! conformance the crate's Unicode version must match; all golden NFC vectors
//! (currently only U+0065 U+0301 → U+00E9) are stable across Unicode versions.

use std::cmp::Ordering;

use unicode_normalization::UnicodeNormalization;

use crate::errors::{CanonicalError, Result};
use crate::unicode_assigned::is_assigned_code_point;

/// CE v1.3 §3.2 domain restriction: a canonical string MUST contain only code
/// points assigned as of Unicode 15.1. This keeps NFC identical across the
/// TS/Rust/Go backends despite their differing Unicode versions (by the Unicode
/// Normalization Stability Policy). Errors on the first unassigned scalar.
pub fn assert_assigned(s: &str) -> Result<()> {
    for ch in s.chars() {
        if !is_assigned_code_point(ch as u32) {
            return Err(CanonicalError::noncanonical(
                "UTF8_UNASSIGNED_CODEPOINT",
                format!("code point U+{:04X} is not assigned as of Unicode 15.1", ch as u32),
            ));
        }
    }
    Ok(())
}

/// NFC-normalize a string and return the UTF-8 bytes. Errors if the input
/// begins with a BOM (U+FEFF) or contains a code point unassigned as of 15.1.
pub fn utf8_nfc_bytes(s: &str) -> Result<Vec<u8>> {
    if s.starts_with('\u{FEFF}') {
        return Err(CanonicalError::noncanonical(
            "UTF8_BOM_FORBIDDEN",
            "BOM at start of string is forbidden",
        ));
    }
    assert_assigned(s)?;
    let normalized: String = s.nfc().collect();
    Ok(normalized.into_bytes())
}

/// Compare two strings by their NFC UTF-8 byte sequences.
pub fn compare_nfc(a: &str, b: &str) -> Result<Ordering> {
    let ab = utf8_nfc_bytes(a)?;
    let bb = utf8_nfc_bytes(b)?;
    Ok(ab.cmp(&bb))
}
