//! `paradigm-terra-cal-gas` — Rust parity implementation of the Paradigm Terra
//! CAL gas layer (CAL Execution Spec v0.1.0-draft §9): the gas-unit model
//! (reusing the DSL cost model), nano-PTRA pricing, the upfront escrow gate
//! (§9.3), and the per-outcome refund/retention bill (§9.4).
//!
//! This crate mirrors the TypeScript reference (`@paradigm-terra/cal-gas`)
//! byte-for-byte. The parity test in `tests/parity.rs` loads the committed
//! `../cal-gas/vectors/golden.json` produced by the TS implementation and
//! verifies that every gas unit, amount, bill, and the admission gate is
//! reproduced exactly. The DSL cost model is reused from `paradigm-terra-dsl`;
//! JCS parsing/serialization from `paradigm-terra-canonical`; uint256 arithmetic
//! is vendored in `src/u256.rs`.

pub mod errors;
pub mod pricing;
pub mod settle;
pub mod u256;
pub mod units;
pub mod util;

pub use errors::{GasError, GasResult};
pub use pricing::{
    balance_of, can_validate, escrow_requirement, flat_validation_fee, gas_price,
    max_expected_dynamic_gas, to_nano, DEFAULT_FLAT_VALIDATION_FEE, DEFAULT_GAS_PRICE,
    GAS_LIMIT_FEE_MULTIPLIER,
};
pub use settle::{settle, GasBill, Outcome};
pub use u256::U256;
pub use units::{
    effects_bytes, gas_units, mcp_call_units, static_gas_units, INVARIANT_BASE, MCP_READ,
    MCP_WRITE, STATE_RENT_PER_BYTE,
};
pub use util::{as_big, get_in};
