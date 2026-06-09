//! The reducer: `apply(State, Event) -> Result<State, ApplyError>` (mirrors
//! `apply.ts`, §7.1). Total, deterministic, per-CAL staging. Events are
//! self-describing; the reducer replays Deltas and moves carried values only.

use paradigm_terra_canonical::jcs::JcsValue;

use crate::delta::apply_delta_json;
use crate::errors::ApplyError;
use crate::state::{delete_in, get_in, set_in};
use crate::u256::U256;

fn err(code: &'static str) -> ApplyError {
    ApplyError::new(code)
}

fn req_str<'a>(ev: &'a JcsValue, k: &str) -> Result<&'a str, ApplyError> {
    ev.get(k).and_then(|x| x.as_str()).ok_or_else(|| err("BAD_DELTA"))
}
fn req_uint(ev: &JcsValue, k: &str) -> Result<U256, ApplyError> {
    match ev.get(k) {
        Some(JcsValue::Int(s)) => U256::from_dec_str(s).ok_or_else(|| err("BAD_DELTA")),
        _ => Err(err("BAD_DELTA")),
    }
}
fn opt_uint(ev: &JcsValue, k: &str) -> Result<U256, ApplyError> {
    if ev.get(k).is_some() {
        req_uint(ev, k)
    } else {
        Ok(U256::ZERO)
    }
}
fn u256_at(state: &JcsValue, path: &[&str]) -> U256 {
    match get_in(state, path) {
        Some(JcsValue::Int(s)) => U256::from_dec_str(s).unwrap_or(U256::ZERO),
        _ => U256::ZERO,
    }
}
fn int_val(u: U256) -> JcsValue {
    JcsValue::Int(u.to_dec_str())
}

fn stage_of<'a>(h: &'a JcsValue) -> Option<&'a str> {
    h.get("stage").and_then(|x| x.as_str())
}

fn bump_nonce(state: &JcsValue, agent: &str) -> JcsValue {
    let cur = u256_at(state, &["cal", "nonces", agent]);
    set_in(state, &["cal", "nonces", agent], int_val(cur.checked_add(&U256([1, 0, 0, 0])).unwrap()))
}
fn add_fees(state: &JcsValue, amount: U256) -> Result<JcsValue, ApplyError> {
    let cur = u256_at(state, &["treasury", "collected_fees_window"]);
    let next = cur.checked_add(&amount).ok_or_else(|| err("OVERFLOW"))?;
    Ok(set_in(state, &["treasury", "collected_fees_window"], int_val(next)))
}

fn recompute_bounded(state: &JcsValue) -> JcsValue {
    let mut bounded = false;
    if let Some(JcsValue::Int(t)) = get_in(state, &["governance", "params", "capture_guard_threshold"]) {
        if let Some(threshold) = U256::from_dec_str(t) {
            if let Some(JcsValue::Object(counters)) = get_in(state, &["failure_mode", "capture_guard_counters"]) {
                for (_, v) in counters {
                    if let JcsValue::Int(s) = v {
                        if let Some(c) = U256::from_dec_str(s) {
                            if c >= threshold {
                                bounded = true;
                            }
                        }
                    }
                }
            }
        }
    }
    set_in(state, &["failure_mode", "is_bounded_mode"], JcsValue::Bool(bounded))
}

/// Apply one event. Total: returns `Err(ApplyError)` rather than panicking.
pub fn apply(state: &JcsValue, ev: &JcsValue) -> Result<JcsValue, ApplyError> {
    let etype = ev.get("event_type").and_then(|x| x.as_str()).ok_or_else(|| err("UNKNOWN_EVENT"))?;

    match etype {
        "cal.created" => {
            let ch = req_str(ev, "cal_hash")?;
            let agent = req_str(ev, "agent_id")?;
            if get_in(state, &["cal", "in_flight", ch]).is_some() {
                return Err(err("DUPLICATE_CAL"));
            }
            if let Some(JcsValue::Object(all)) = get_in(state, &["cal", "in_flight"]) {
                for (_, h) in all {
                    if h.get("agent_id").and_then(|x| x.as_str()) == Some(agent) {
                        return Err(err("AGENT_BUSY"));
                    }
                }
            }
            let entry = JcsValue::object(vec![
                ("agent_id", JcsValue::string(agent)),
                ("stage", JcsValue::string("CREATED")),
                ("escrowed_ptra", JcsValue::int_u128(0)),
                ("gas_consumed_ptra", JcsValue::int_u128(0)),
                ("staged", JcsValue::array(vec![])),
            ]);
            Ok(set_in(state, &["cal", "in_flight", ch], entry))
        }
        "cal.signed" => {
            let ch = req_str(ev, "cal_hash")?;
            let h = get_in(state, &["cal", "in_flight", ch]).ok_or_else(|| err("UNKNOWN_CAL"))?;
            if stage_of(h) != Some("CREATED") {
                return Err(err("BAD_STAGE"));
            }
            Ok(set_in(state, &["cal", "in_flight", ch, "stage"], JcsValue::string("SIGNED")))
        }
        "cal.validated" => {
            let ch = req_str(ev, "cal_hash")?;
            let h = get_in(state, &["cal", "in_flight", ch]).ok_or_else(|| err("UNKNOWN_CAL"))?;
            if stage_of(h) != Some("SIGNED") {
                return Err(err("BAD_STAGE"));
            }
            let agent = h.get("agent_id").and_then(|x| x.as_str()).ok_or_else(|| err("BAD_DELTA"))?.to_string();
            // §9.3 upfront deposit: escrow = Flat_Validation_Fee + Max_Expected_Dynamic_Gas.
            // The reducer debits the full escrow; the unused gas is refunded at the terminal
            // event and the treasury keeps escrow − refund (= fee + consumed).
            let escrow = req_uint(ev, "escrow_ptra")?;
            let nb = u256_at(state, &["ptra", "balances", &agent]).checked_sub(&escrow).ok_or_else(|| err("INSUFFICIENT_BALANCE"))?;
            let s = set_in(state, &["ptra", "balances", &agent], int_val(nb));
            let s = set_in(&s, &["cal", "in_flight", ch, "escrowed_ptra"], int_val(escrow));
            Ok(set_in(&s, &["cal", "in_flight", ch, "stage"], JcsValue::string("VALIDATED")))
        }
        "cal.executed" => {
            let ch = req_str(ev, "cal_hash")?;
            let h = get_in(state, &["cal", "in_flight", ch]).ok_or_else(|| err("UNKNOWN_CAL"))?;
            if stage_of(h) != Some("VALIDATED") {
                return Err(err("BAD_STAGE"));
            }
            let effects = ev.get("effects").filter(|e| e.as_array().is_some()).cloned().ok_or_else(|| err("BAD_DELTA"))?;
            let gas = req_uint(ev, "gas_consumed_ptra")?;
            let s = set_in(state, &["cal", "in_flight", ch, "staged"], effects);
            let s = set_in(&s, &["cal", "in_flight", ch, "gas_consumed_ptra"], int_val(gas));
            Ok(set_in(&s, &["cal", "in_flight", ch, "stage"], JcsValue::string("EXECUTED")))
        }
        "cal.settled" => {
            let ch = req_str(ev, "cal_hash")?;
            let h = get_in(state, &["cal", "in_flight", ch]).ok_or_else(|| err("UNKNOWN_CAL"))?;
            if stage_of(h) != Some("EXECUTED") {
                return Err(err("BAD_STAGE"));
            }
            Ok(set_in(state, &["cal", "in_flight", ch, "stage"], JcsValue::string("SETTLED")))
        }
        "cal.finalized" => {
            let ch = req_str(ev, "cal_hash")?;
            let h = get_in(state, &["cal", "in_flight", ch]).ok_or_else(|| err("UNKNOWN_CAL"))?;
            if stage_of(h) != Some("SETTLED") {
                return Err(err("BAD_STAGE"));
            }
            let agent = h.get("agent_id").and_then(|x| x.as_str()).ok_or_else(|| err("BAD_DELTA"))?.to_string();
            // Refund the unused gas from the escrow; the treasury keeps escrow − refund
            // (= Flat_Validation_Fee + consumed gas). The agent's net debit equals the
            // treasury's gain.
            let escrowed = u256_at(state, &["cal", "in_flight", ch, "escrowed_ptra"]);
            let staged: Vec<JcsValue> = match h.get("staged").and_then(|x| x.as_array()) {
                Some(a) => a.to_vec(),
                None => Vec::new(),
            };
            let refund = opt_uint(ev, "gas_refunded_ptra")?;
            let mut s = state.clone();
            for d in &staged {
                s = apply_delta_json(&s, d)?; // commit
            }
            if !refund.is_zero() {
                let nb = u256_at(&s, &["ptra", "balances", &agent]).checked_add(&refund).ok_or_else(|| err("OVERFLOW"))?;
                s = set_in(&s, &["ptra", "balances", &agent], int_val(nb));
            }
            let retained = escrowed.checked_sub(&refund).ok_or_else(|| err("UNDERFLOW"))?;
            s = add_fees(&s, retained)?;
            s = bump_nonce(&s, &agent);
            Ok(delete_in(&s, &["cal", "in_flight", ch]))
        }
        "cal.failed" | "cal.expired" => {
            let ch = req_str(ev, "cal_hash")?;
            let h = get_in(state, &["cal", "in_flight", ch]).ok_or_else(|| err("UNKNOWN_CAL"))?;
            let agent = h.get("agent_id").and_then(|x| x.as_str()).ok_or_else(|| err("BAD_DELTA"))?.to_string();
            let pre_validated = matches!(stage_of(h), Some("CREATED") | Some("SIGNED"));
            // Staged effects are discarded (all-or-nothing, §3.5). The fee/gas settlement
            // splits by whether the CAL escrowed.
            let mut s = state.clone();
            if pre_validated {
                // Pre-VALIDATED: no escrow was ever taken (no cal.validated). §9.4 charges a
                // spam fee on PRECOND_FALSE/CAPABILITY_DENIED — the event carries it
                // (min(fee, balance), baked by the validator); debit it and retain it.
                // No-charge / ingress-class failures carry 0.
                let charge_now = opt_uint(ev, "fee_debited_ptra")?;
                if !charge_now.is_zero() {
                    let nb = u256_at(&s, &["ptra", "balances", &agent]).checked_sub(&charge_now).ok_or_else(|| err("INSUFFICIENT_BALANCE"))?;
                    s = set_in(&s, &["ptra", "balances", &agent], int_val(nb));
                }
                s = add_fees(&s, charge_now)?;
            } else {
                // Post-VALIDATED: the escrow (fee + maxGas) was debited at cal.validated.
                // Refund the unused gas; the treasury keeps escrow − refund (= fee +
                // consumed). Same arithmetic as cal.finalized, but staged effects drop.
                let escrowed = u256_at(state, &["cal", "in_flight", ch, "escrowed_ptra"]);
                let refund = opt_uint(ev, "gas_refunded_ptra")?;
                if !refund.is_zero() {
                    let nb = u256_at(&s, &["ptra", "balances", &agent]).checked_add(&refund).ok_or_else(|| err("OVERFLOW"))?;
                    s = set_in(&s, &["ptra", "balances", &agent], int_val(nb));
                }
                let retained = escrowed.checked_sub(&refund).ok_or_else(|| err("UNDERFLOW"))?;
                s = add_fees(&s, retained)?;
            }
            s = bump_nonce(&s, &agent);
            Ok(delete_in(&s, &["cal", "in_flight", ch]))
        }
        "ptra.transferred" => {
            let from = req_str(ev, "from")?.to_string();
            let to = req_str(ev, "to")?.to_string();
            let amount = req_uint(ev, "amount_nano_ptra")?;
            let nb_from = u256_at(state, &["ptra", "balances", &from]).checked_sub(&amount).ok_or_else(|| err("INSUFFICIENT_BALANCE"))?;
            let s = set_in(state, &["ptra", "balances", &from], int_val(nb_from));
            let nb_to = u256_at(&s, &["ptra", "balances", &to]).checked_add(&amount).ok_or_else(|| err("OVERFLOW"))?;
            Ok(set_in(&s, &["ptra", "balances", &to], int_val(nb_to)))
        }
        "ptra.shadow_init" => {
            let addr = req_str(ev, "addr")?;
            if get_in(state, &["ptra", "balances", addr]).is_some() {
                return Ok(state.clone());
            }
            Ok(set_in(state, &["ptra", "balances", addr], JcsValue::int_u128(0)))
        }
        "oracle.feed_submitted" => {
            let symbol = req_str(ev, "symbol")?;
            let value = ev.get("value").cloned().unwrap_or(JcsValue::Null);
            Ok(set_in(state, &["oracles", "feeds", symbol], value))
        }
        "tick.advanced" => {
            let next = req_uint(ev, "new_tick")?;
            let cur = match get_in(state, &["tick", "current"]) {
                Some(JcsValue::Int(s)) => U256::from_dec_str(s).ok_or_else(|| err("BAD_TICK"))?,
                _ => return Err(err("BAD_TICK")),
            };
            if next <= cur {
                return Err(err("BAD_TICK"));
            }
            let s = set_in(state, &["tick", "current"], int_val(next));
            Ok(recompute_bounded(&s))
        }
        _ => Err(err("UNKNOWN_EVENT")),
    }
}
