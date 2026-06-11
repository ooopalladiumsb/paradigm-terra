//! Per-outcome refund / retention bill (CAL Spec §9.4). Given a terminal outcome
//! and the observed bytes written, compute the nano-PTRA amounts a validator
//! bakes into the events. Pure; conservation against the reducer's fee
//! arithmetic is a validator-phase concern (the reducer is frozen).

use paradigm_terra_canonical::jcs::JcsValue;

use crate::errors::GasResult;
use crate::pricing::{balance_of, flat_validation_fee, gas_price, max_expected_dynamic_gas, to_nano};
use crate::u256::U256;
use crate::units::gas_units;
use crate::util::get_in;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Finalized,
    FailedPrecond,  // PRECOND_FALSE / CAPABILITY_DENIED — §9.4 spam charge: min(fee, balance)
    FailedNoCharge, // UNKNOWN_ACTION / NONCE_MISMATCH / PRECOND_ERROR / escrow shortfall — no PTRA
    FailedExec,     // STEP_ERROR / POSTCOND_FALSE / INVARIANT_FALSE / OUT_OF_GAS
    ExpiredPre,     // expired before VALIDATED — no PTRA touched
    ExpiredPost,    // expired after VALIDATED — flat fee retained
}

impl Outcome {
    pub fn from_str(s: &str) -> Option<Outcome> {
        match s {
            "FINALIZED" => Some(Outcome::Finalized),
            "FAILED_PRECOND" => Some(Outcome::FailedPrecond),
            "FAILED_NO_CHARGE" => Some(Outcome::FailedNoCharge),
            "FAILED_EXEC" => Some(Outcome::FailedExec),
            "EXPIRED_PRE" => Some(Outcome::ExpiredPre),
            "EXPIRED_POST" => Some(Outcome::ExpiredPost),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GasBill {
    pub fee_retained: U256,
    pub dynamic_gas_consumed: U256,
    pub gas_refunded: U256,
    pub total_agent_charge: U256,
}

/// Compute the gas bill for a terminal CAL outcome (§9.4).
pub fn settle(outcome: Outcome, cal: &JcsValue, state: &JcsValue, bytes_written: &U256, owner_auth: &U256) -> GasResult<GasBill> {
    let fee = flat_validation_fee(state);
    let max_gas = max_expected_dynamic_gas(cal, fee);

    let bill = match outcome {
        Outcome::ExpiredPre | Outcome::FailedNoCharge => GasBill {
            fee_retained: U256::ZERO,
            dynamic_gas_consumed: U256::ZERO,
            gas_refunded: U256::ZERO,
            total_agent_charge: U256::ZERO,
        },
        Outcome::FailedPrecond => {
            // §9.4 spam charge for a pre-VALIDATED failure. No escrow was taken
            // (the §9.3 gate runs *after* capability/precond), so the fee is
            // charged directly at the failure event and capped at the agent's
            // balance — the most that can honestly be taken before escrow.
            let balance = match get_in(cal, &["agent_id"]).and_then(JcsValue::as_str) {
                Some(agent) => balance_of(state, agent),
                None => U256::ZERO,
            };
            let spam = if balance < fee { balance } else { fee };
            GasBill {
                fee_retained: spam,
                dynamic_gas_consumed: U256::ZERO,
                gas_refunded: U256::ZERO,
                total_agent_charge: spam,
            }
        }
        Outcome::ExpiredPost => GasBill {
            // post-VALIDATED: the fee was already escrowed at cal.validated.
            fee_retained: fee,
            dynamic_gas_consumed: U256::ZERO,
            gas_refunded: max_gas,
            total_agent_charge: fee,
        },
        Outcome::Finalized | Outcome::FailedExec => {
            // consumed gas, capped at the escrowed budget (overrun ⇒ OUT_OF_GAS path)
            let raw = to_nano(gas_units(cal, bytes_written, owner_auth)?, gas_price(state));
            let consumed = if raw > max_gas { max_gas } else { raw };
            GasBill {
                fee_retained: fee,
                dynamic_gas_consumed: consumed,
                gas_refunded: max_gas.saturating_sub(&consumed),
                total_agent_charge: fee + consumed,
            }
        }
    };
    Ok(bill)
}
