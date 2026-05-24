//! `paradigm-terra-canonical` — Rust parity implementation of the Paradigm
//! Terra Canonical Encoding Specification v1.3 (SCF) with v0.10.0-draft domain
//! tag extensions (STATE_ROOT_V1, DSL_V1.2).
//!
//! This crate mirrors the TypeScript reference (`@paradigm-terra/canonical`)
//! byte-for-byte. The parity test in `tests/parity.rs` loads the committed
//! `vectors/golden.json` produced by the TS implementation and verifies that
//! every primitive here reproduces the recorded bytes and hashes.
//!
//! Surface:
//!   - `integers`:  int256 / uint256 (decimal-string) and uint64/16/8 BE
//!   - `strings`:   UTF-8 NFC normalization
//!   - `addresses`: canonical raw TON address parsing
//!   - `jcs`:       restricted JCS profile (integers only, no dup keys, no surrogates)
//!   - `hash`:      SHA-256 with domain separation
//!   - `framing`:   [type_tag:u16][version:u16][length:u32][payload]
//!   - `merkle`:    binary balanced Merkle (CE §6, CAL Spec §7.3)
//!   - `domains`:   tag registry (CE §7.1 + v0.10.0-draft)

pub mod addresses;
pub mod domains;
pub mod errors;
pub mod framing;
pub mod hash;
pub mod integers;
pub mod jcs;
pub mod merkle;
pub mod sha256;
pub mod strings;
pub mod unicode_assigned;

pub use errors::{CanonicalError, ErrorClass, Result};
