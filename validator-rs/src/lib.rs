//! `paradigm-terra-cal-validator` — Rust parity implementation of the Paradigm
//! Terra CAL validator (CAL Execution Spec v0.1.0-draft §3–§9). A pure
//! `validate(cal, cal_hash_hex, snapshot, trace)` drives a SIGNED CAL through the
//! lifecycle state machine and emits the reducer-ready stage events, wiring the
//! DSL evaluator + taxonomy (paradigm-terra-dsl) and gas pricing/settlement
//! (paradigm-terra-cal-gas) into one verdict. It evaluates, it does not execute:
//! external MCP step effects arrive as an execution trace (§4.1).
//!
//! Mirrors the TypeScript reference (`@paradigm-terra/cal-validator`)
//! byte-for-byte; `tests/parity.rs` loads the committed
//! `../validator/vectors/golden.json` and reproduces every emitted event
//! sequence, economic field, and bill.

pub mod trace;
pub mod validate;

pub use trace::{ExecutionTrace, StepResult};
pub use validate::{resume_from_validated, validate, validate_to_validated, ToValidated, ValidationResult};
