//! `paradigm-terra-cal-reducer` — Rust parity implementation of the CAL event
//! reducer (CAL Spec §7.1): `apply(State, Event) -> State` as a pure total fold
//! with per-CAL effect staging. Mirrors the TypeScript reference
//! (`@paradigm-terra/cal-reducer`) byte-for-byte; `tests/parity.rs` verifies
//! against `../cal-reducer/vectors/golden.json`. STATE_ROOT / JCS come from
//! canonical-rs; uint256 arithmetic is vendored in `u256`.

pub mod apply;
pub mod delta;
pub mod errors;
pub mod fold;
pub mod state;
pub mod u256;

pub use apply::apply;
pub use errors::ApplyError;
pub use fold::{materialize, scan_state_roots};
pub use state::{genesis, state_root_of};
