//! The CAL validator pipeline (mirrors `validate.ts`, CAL Spec §3–§9). Pure;
//! drives a SIGNED CAL through the lifecycle from `(cal, snapshot, trace)`,
//! emitting the reducer-ready stage events. Reuses dsl-rs (`run` + taxonomy) and
//! cal-gas-rs (escrow gate + §9.4 settlement).

use std::collections::HashSet;

use paradigm_terra_canonical::jcs::JcsValue;
use paradigm_terra_cal_gas::{
    as_big, can_validate, effects_bytes, flat_validation_fee, gas_price, gas_units, get_in,
    max_expected_dynamic_gas, settle, to_nano, GasBill, GasError, Outcome as GasOutcome, U256,
};
use paradigm_terra_dsl::taxonomy::{is_owner_required, is_registered_action, required_scopes};
use paradigm_terra_dsl::{run, Bindings, Outcome as DslOutcome, Scope, Version};

use crate::trace::ExecutionTrace;

pub struct ValidationResult {
    pub events: Vec<JcsValue>,
    pub terminal_stage: &'static str, // FINALIZED | FAILED | EXPIRED
    pub reason_code: Option<&'static str>,
    pub reason_detail: String,
    pub bill: GasBill,
}

fn si(s: &str) -> JcsValue {
    JcsValue::Str(s.to_string())
}
fn ii(u: &U256) -> JcsValue {
    JcsValue::Int(u.to_dec_str())
}
fn id_pairs(cal_hash: &str, agent: &str, nonce: &U256) -> Vec<(&'static str, JcsValue)> {
    vec![("cal_hash", si(cal_hash)), ("agent_id", si(agent)), ("nonce", ii(nonce))]
}

/// Evaluate an embedded expression; a `{dsl_version, expr}` envelope overrides v1.2.
fn eval_expr(node: Option<&JcsValue>, scope: Scope, b: &Bindings) -> DslOutcome {
    let mut version = Version::V12;
    let mut expr = node;
    if let Some(obj) = node {
        if obj.get("dsl_version").is_some() {
            version = match obj.get("dsl_version").and_then(JcsValue::as_str) {
                Some("1.1") => Version::V11,
                Some("1.2") => Version::V12,
                _ => return DslOutcome { code: "VALIDATION_ERROR".into(), reason: Some("UNSUPPORTED_VERSION".into()) },
            };
            expr = obj.get("expr");
        }
    }
    match expr {
        Some(j) => run(j, scope, version, b),
        None => DslOutcome { code: "PARSE_ERROR".into(), reason: Some("MALFORMED_NODE".into()) },
    }
}

fn capability_grants(snapshot: &JcsValue, agent: &str, action: &str) -> bool {
    let required = required_scopes(action);
    if required.is_empty() {
        return true;
    }
    let granted: HashSet<&str> = match get_in(snapshot, &["registry", "agents", agent, "granted_scopes"]) {
        Some(JcsValue::Array(items)) => items.iter().filter_map(JcsValue::as_str).collect(),
        _ => HashSet::new(),
    };
    required.iter().all(|s| granted.contains(s))
}

fn is_true(o: &DslOutcome) -> bool {
    o.code == "EVALUATION_TRUE"
}

/// Validate a SIGNED CAL against the snapshot and execution trace, producing the
/// lifecycle events and terminal outcome. `cal_hash_hex` is opaque (echoed into
/// every event's `cal_hash`).
pub fn validate(cal: &JcsValue, cal_hash_hex: &str, snapshot: &JcsValue, trace: &ExecutionTrace) -> Result<ValidationResult, GasError> {
    let agent = get_in(cal, &["agent_id"]).and_then(JcsValue::as_str).unwrap_or("").to_string();
    let action = get_in(cal, &["action"]).and_then(JcsValue::as_str).unwrap_or("").to_string();
    let nonce = as_big(get_in(cal, &["nonce"]), U256::ZERO);
    let expiration = as_big(get_in(cal, &["expiration_tick"]), U256::ZERO);
    let tick = trace.current_tick;
    let fee = flat_validation_fee(snapshot);

    let mut events: Vec<JcsValue> = Vec::new();

    let mk = |events: Vec<JcsValue>, stage: &'static str, reason: Option<&'static str>, detail: String, bill: GasBill| ValidationResult {
        events,
        terminal_stage: stage,
        reason_code: reason,
        reason_detail: detail,
        bill,
    };

    // 1. action registered (§2.3) — malformed, §9.1 ingress-class, no charge
    if !is_registered_action(&action) {
        return pre_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "UNKNOWN_ACTION", "action not in §2.3 registry", GasOutcome::FailedNoCharge);
    }

    // 2. expiration before VALIDATED (§3.4) — no PTRA
    if tick > expiration {
        let bill = settle(GasOutcome::ExpiredPre, cal, snapshot, &U256::ZERO)?;
        let mut p = id_pairs(cal_hash_hex, &agent, &nonce);
        p.extend([("event_type", si("cal.expired")), ("tick_expired", ii(&tick)), ("gas_consumed_ptra", ii(&U256::ZERO)), ("ton_ingress_fee_paid", ii(&U256::ZERO))]);
        events.push(JcsValue::object(p));
        return Ok(mk(events, "EXPIRED", None, "expired before VALIDATED".into(), bill));
    }

    // 3. nonce (§6.2) — malformed/replay, §9.1 ingress-class, no charge
    let expected = as_big(get_in(snapshot, &["cal", "nonces", &agent]), U256::ZERO).checked_add(&U256::from_u64(1)).expect("nonce overflow");
    if nonce != expected {
        return pre_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "NONCE_MISMATCH", "nonce mismatch", GasOutcome::FailedNoCharge);
    }

    // 4. owner-sig (§8.2) — §9.4 spam charge
    if is_owner_required(&action) && !trace.owner_sig_present {
        return pre_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "CAPABILITY_DENIED", "owner_sig required", GasOutcome::FailedPrecond);
    }

    // 5. scope grant (§4.3) — §9.4 spam charge
    if !capability_grants(snapshot, &agent, &action) {
        return pre_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "CAPABILITY_DENIED", "agent lacks required scope", GasOutcome::FailedPrecond);
    }

    // 6. preconditions — PRECOND_FALSE retains the §9.4 fee; PRECOND_ERROR is ingress-class, no charge
    let pre = eval_expr(get_in(cal, &["preconditions"]), Scope::Precondition, &Bindings { state: Some(snapshot.clone()), ..Default::default() });
    if !is_true(&pre) {
        let (reason, outcome) = if pre.code == "EVALUATION_FALSE" {
            ("PRECOND_FALSE", GasOutcome::FailedPrecond)
        } else {
            ("PRECOND_ERROR", GasOutcome::FailedNoCharge)
        };
        return pre_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, reason, "preconditions not satisfied", outcome);
    }

    // 7. escrow gate (§9.3) — agent cannot cover escrow, no PTRA can be taken.
    //    §3.5: dedicated INSUFFICIENT_ESCROW, distinct from the gate-11 OUT_OF_GAS overrun.
    if !can_validate(cal, snapshot) {
        return pre_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "INSUFFICIENT_ESCROW", "balance < escrow (§9.3)", GasOutcome::FailedNoCharge);
    }

    // --- cal.validated: §9.3 upfront deposit — escrow = fee + Max_Expected_Dynamic_Gas.
    // The reducer debits the full escrow; the unused gas is refunded at the terminal
    // event (gas_refunded_ptra) and the treasury keeps escrow − refund.
    let max_gas = max_expected_dynamic_gas(cal, fee);
    {
        let mut p = id_pairs(cal_hash_hex, &agent, &nonce);
        p.push(("event_type", si("cal.validated")));
        p.push(("escrow_ptra", ii(&fee.checked_add(&max_gas).expect("escrow overflow"))));
        events.push(JcsValue::object(p));
    }

    // 8. expiration recheck (defensive; constant tick → never fires here)
    if tick > expiration {
        let bill = settle(GasOutcome::ExpiredPost, cal, snapshot, &U256::ZERO)?;
        let mut p = id_pairs(cal_hash_hex, &agent, &nonce);
        p.extend([("event_type", si("cal.expired")), ("tick_expired", ii(&tick)), ("gas_consumed_ptra", ii(&U256::ZERO)), ("gas_refunded_ptra", ii(&bill.gas_refunded)), ("ton_ingress_fee_paid", ii(&U256::ZERO))]);
        events.push(JcsValue::object(p));
        return Ok(mk(events, "EXPIRED", None, "expired after VALIDATED".into(), bill));
    }

    // 9–10. steps
    let steps: Vec<JcsValue> = match get_in(cal, &["steps"]) {
        Some(JcsValue::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let mut committed: Vec<JcsValue> = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let tr = trace.steps.get(i);
        if tr.map(|t| t.ok) != Some(true) {
            let detail = tr.and_then(|t| t.error_detail.clone()).unwrap_or_else(|| format!("step {i} failed"));
            return exec_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "STEP_ERROR", &detail, &committed);
        }
        committed.extend(tr.unwrap().effects.iter().cloned());
        if let Some(JcsValue::Array(pcs)) = get_in(step, &["post_conditions"]) {
            let params = get_in(step, &["params"]).cloned();
            for pc in pcs {
                let b = Bindings { before: Some(trace.state_before.clone()), after: Some(trace.state_after.clone()), params: params.clone(), ..Default::default() };
                let o = eval_expr(Some(pc), Scope::PostCondition, &b);
                if !is_true(&o) {
                    let reason = if o.code == "EVALUATION_FALSE" { "POSTCOND_FALSE" } else { "STEP_ERROR" };
                    return exec_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, reason, "post_condition not satisfied", &committed);
                }
            }
        }
    }

    // 11. dynamic gas vs budget (§9.3)
    let bytes_written = effects_bytes(&JcsValue::Array(committed.clone()))?;
    let raw_gas = to_nano(gas_units(cal, &bytes_written)?, gas_price(snapshot));
    if raw_gas > max_gas {
        return exec_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "OUT_OF_GAS", "dynamic gas exceeds budget", &committed);
    }
    let consumed = raw_gas;

    // --- cal.executed ---
    {
        let mut p = id_pairs(cal_hash_hex, &agent, &nonce);
        p.push(("event_type", si("cal.executed")));
        p.push(("effects", JcsValue::Array(committed.clone())));
        p.push(("gas_consumed_ptra", ii(&consumed)));
        events.push(JcsValue::object(p));
    }

    // 12. expiration recheck (defensive)
    if tick > expiration {
        let bill = settle(GasOutcome::ExpiredPost, cal, snapshot, &U256::ZERO)?;
        let mut p = id_pairs(cal_hash_hex, &agent, &nonce);
        p.extend([("event_type", si("cal.expired")), ("tick_expired", ii(&tick)), ("gas_consumed_ptra", ii(&U256::ZERO)), ("gas_refunded_ptra", ii(&bill.gas_refunded)), ("ton_ingress_fee_paid", ii(&U256::ZERO))]);
        events.push(JcsValue::object(p));
        return Ok(mk(events, "EXPIRED", None, "expired after VALIDATED".into(), bill));
    }

    // 13. invariants
    let invariants: Vec<JcsValue> = match get_in(cal, &["invariants"]) {
        Some(JcsValue::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    for inv in &invariants {
        let b = Bindings { before: Some(trace.state_before.clone()), after: Some(trace.state_after.clone()), ..Default::default() };
        let o = eval_expr(Some(inv), Scope::Invariant, &b);
        if !is_true(&o) {
            return exec_fail(&mut events, cal, snapshot, cal_hash_hex, &agent, &nonce, &tick, "INVARIANT_FALSE", "invariant not satisfied", &committed);
        }
    }

    // --- cal.settled + cal.finalized ---
    events.push(JcsValue::object(vec![("event_type", si("cal.settled")), ("cal_hash", si(cal_hash_hex))]));
    let bill = settle(GasOutcome::Finalized, cal, snapshot, &bytes_written)?;
    {
        let mut p = id_pairs(cal_hash_hex, &agent, &nonce);
        p.extend([
            ("event_type", si("cal.finalized")),
            ("tick_finalized", ii(&tick)),
            ("gas_consumed_ptra", ii(&consumed)),
            ("gas_refunded_ptra", ii(&bill.gas_refunded)),
            ("steps_applied", ii(&U256::from_u64(steps.len() as u64))),
            ("invariants_checked", ii(&U256::from_u64(invariants.len() as u64))),
        ]);
        events.push(JcsValue::object(p));
    }
    Ok(mk(events, "FINALIZED", None, String::new(), bill))
}

/// Pre-VALIDATED FAILED (gates 1, 3–7): no cal.validated fires. The cal.failed
/// event carries `fee_debited_ptra` (= the bill's fee_retained), which the
/// reducer debits at cal.failed (Tier-2 revision). `FailedPrecond` retains the
/// §9.4 spam charge min(fee, balance); `FailedNoCharge` (malformed/replay/escrow
/// shortfall) is §9.1 ingress-class and retains nothing. events == bill either way.
#[allow(clippy::too_many_arguments)]
fn pre_fail(
    events: &mut Vec<JcsValue>,
    cal: &JcsValue,
    snapshot: &JcsValue,
    cal_hash: &str,
    agent: &str,
    nonce: &U256,
    tick: &U256,
    reason: &'static str,
    detail: &str,
    outcome: GasOutcome,
) -> Result<ValidationResult, GasError> {
    let bill = settle(outcome, cal, snapshot, &U256::ZERO)?;
    let mut p = id_pairs(cal_hash, agent, nonce);
    p.extend([
        ("event_type", si("cal.failed")),
        ("tick_failed", ii(tick)),
        ("reason_code", si(reason)),
        ("fee_debited_ptra", ii(&bill.fee_retained)),
        ("gas_consumed_ptra", ii(&U256::ZERO)),
        ("ton_ingress_fee_paid", ii(&U256::ZERO)),
    ]);
    events.push(JcsValue::object(p));
    Ok(ValidationResult { events: std::mem::take(events), terminal_stage: "FAILED", reason_code: Some(reason), reason_detail: detail.to_string(), bill })
}

/// Execution-phase FAILED (gates 9–13): fee + consumed gas retained (§9.4 bill).
#[allow(clippy::too_many_arguments)]
fn exec_fail(
    events: &mut Vec<JcsValue>,
    cal: &JcsValue,
    snapshot: &JcsValue,
    cal_hash: &str,
    agent: &str,
    nonce: &U256,
    tick: &U256,
    reason: &'static str,
    detail: &str,
    committed: &[JcsValue],
) -> Result<ValidationResult, GasError> {
    let bytes_written = effects_bytes(&JcsValue::Array(committed.to_vec()))?;
    let bill = settle(GasOutcome::FailedExec, cal, snapshot, &bytes_written)?;
    let mut p = id_pairs(cal_hash, agent, nonce);
    p.extend([
        ("event_type", si("cal.failed")),
        ("tick_failed", ii(tick)),
        ("reason_code", si(reason)),
        ("gas_consumed_ptra", ii(&bill.dynamic_gas_consumed)),
        ("gas_refunded_ptra", ii(&bill.gas_refunded)),
        ("ton_ingress_fee_paid", ii(&U256::ZERO)),
    ]);
    events.push(JcsValue::object(p));
    Ok(ValidationResult { events: std::mem::take(events), terminal_stage: "FAILED", reason_code: Some(reason), reason_detail: detail.to_string(), bill })
}
