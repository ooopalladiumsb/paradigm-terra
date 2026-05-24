//! `paradigm-terra-dsl` — Rust parity implementation of Paradigm Terra DSL v1.2
//! (Constraint DSL v1.1 + CAL v0.1.0-draft extensions).
//!
//! This crate mirrors the TypeScript reference (`@paradigm-terra/dsl`)
//! byte-for-byte. The parity test in `tests/parity.rs` loads the committed
//! `../dsl/vectors/golden.json` produced by the TS implementation and verifies
//! that every evaluation outcome (with its reason sub-code) and every DSL_HASH
//! is reproduced exactly. JCS parsing, hashing, NFC and address handling are
//! reused from `paradigm-terra-canonical`.

pub mod ast;
pub mod errors;
pub mod evaluate;
pub mod hash;
pub mod i256;
pub mod parse;
pub mod taxonomy;
pub mod values;

pub use ast::{Expr, Scope, Version};
pub use errors::{DResult, DslError, Phase};
pub use evaluate::{run, Bindings, Outcome};
pub use hash::dsl_hash;
pub use parse::parse_expression;
