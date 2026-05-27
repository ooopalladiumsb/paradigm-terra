//! Rust parity port of the Paradigm Terra orchestrator/node.
//!
//! Mirrors the TypeScript reference (`@paradigm-terra/orchestrator`, `src/node.ts`):
//! a node folds a program of per-tick `{cal, trace}` submissions through
//! `cal.created`/`cal.signed` (ingress) -> `validate()` -> `apply()` over one
//! evolving `State`, recording the STATE_ROOT after every event and the Canonical
//! Encoding v1.3 §6.3 global stream Merkle root per tick; the event log is
//! byte-for-byte replayable. Verified against the TS golden vectors in
//! `../orchestrator/vectors/golden.json` (see `tests/parity.rs`).

pub mod node;

pub use node::{run, replay, NodeError, Program, Submission, SubmissionResult, TickBlock, TickResult, Transcript};
