//! Pricing & escrow (CAL Spec §9.2–§9.3). All amounts are uint256 nano-PTRA.

use paradigm_terra_canonical::jcs::JcsValue;

use crate::u256::U256;
use crate::util::{as_big, get_in};

pub const DEFAULT_GAS_PRICE: u64 = 1000; // nano-PTRA per gas unit (= 1 µPTRA), §9.2 genesis
pub const DEFAULT_FLAT_VALIDATION_FEE: u64 = 100_000; // nano-PTRA, §12.6 placeholder
pub const GAS_LIMIT_FEE_MULTIPLIER: u64 = 100; // default gas_limit = fee × 100, §9.3

pub fn gas_price(state: &JcsValue) -> U256 {
    as_big(
        get_in(state, &["governance", "gas_price_nano_ptra_per_unit"]),
        U256::from_u64(DEFAULT_GAS_PRICE),
    )
}

/// Convert gas units to nano-PTRA.
pub fn to_nano(units: U256, price: U256) -> U256 {
    units * price
}

pub fn flat_validation_fee(state: &JcsValue) -> U256 {
    as_big(
        get_in(state, &["governance", "params", "flat_validation_fee_nano_ptra"]),
        U256::from_u64(DEFAULT_FLAT_VALIDATION_FEE),
    )
}

/// Upper bound the agent escrows for dynamic gas (CAL `gas_limit_ptra`, else fee × 100).
pub fn max_expected_dynamic_gas(cal: &JcsValue, fee: U256) -> U256 {
    as_big(get_in(cal, &["gas_limit_ptra"]), fee * U256::from_u64(GAS_LIMIT_FEE_MULTIPLIER))
}

/// Total PTRA escrowed at SIGNED→VALIDATED (§9.3).
pub fn escrow_requirement(cal: &JcsValue, state: &JcsValue) -> U256 {
    let fee = flat_validation_fee(state);
    fee + max_expected_dynamic_gas(cal, fee)
}

pub fn balance_of(state: &JcsValue, agent: &str) -> U256 {
    as_big(get_in(state, &["ptra", "balances", agent]), U256::ZERO)
}

/// The §9.3 admission gate: the agent must cover the full escrow.
pub fn can_validate(cal: &JcsValue, state: &JcsValue) -> bool {
    match get_in(cal, &["agent_id"]).and_then(JcsValue::as_str) {
        Some(agent) => balance_of(state, agent) >= escrow_requirement(cal, state),
        None => false,
    }
}
