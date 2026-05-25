//! `paradigm-terra-cal` — Rust parity implementation of the Paradigm Terra CAL
//! skeleton (CAL Execution Spec v0.1.0-draft): the immutable, hashable
//! foundation (wire-format validation, CAL_HASH + signing payload, event/receipt
//! hashing, lifecycle). Mirrors the TypeScript reference (`@paradigm-terra/cal`)
//! byte-for-byte; `tests/parity.rs` verifies against `../cal/vectors/golden.json`.
//!
//! Reuses `paradigm-terra-canonical` (JCS / hash / address) and
//! `paradigm-terra-dsl` (embedded-expression parse-validation + taxonomy). The
//! reducer (§7.1) and gas (§9) phases are intentionally absent.

pub mod errors;
pub mod hash;
pub mod lifecycle;
pub mod schema;

pub use errors::{CalError, CheckResult};
pub use hash::{cal_hash, canonical_unsigned_bytes, event_hash, receipt_hash};
pub use lifecycle::transition_event_type;
pub use schema::check_cal;
