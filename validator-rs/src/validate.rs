//! The CAL validator pipeline (mirrors `validate.ts`, CAL Spec §3–§9). Pure;
//! drives a SIGNED CAL through the lifecycle from `(cal, snapshot, trace)`,
//! emitting the reducer-ready stage events. Reuses dsl-rs (`run` + taxonomy) and
//! cal-gas-rs (escrow gate + §9.4 settlement).

use std::collections::HashSet;

use paradigm_terra_canonical::jcs::JcsValue;
use paradigm_terra_cal_gas::{
    as_big, can_validate, effects_bytes, flat_validation_fee, gas_price, gas_units, get_in,
    max_expected_dynamic_gas, owner_auth_units, settle, to_nano, GasBill, GasError, Outcome as GasOutcome, U256,
};
use paradigm_terra_dsl::emergency::effective_invariants;
use paradigm_terra_dsl::taxonomy::{implied_scopes, is_bounded_allowed, is_owner_required, is_registered_action, required_scopes};
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
    let mut granted: HashSet<&str> = HashSet::new();
    if let Some(JcsValue::Array(items)) = get_in(snapshot, &["registry", "agents", agent, "granted_scopes"]) {
        for s in items.iter().filter_map(JcsValue::as_str) {
            granted.insert(s);
            // Annex A tier implication: extend the granted set in place.
            for implied in implied_scopes(s) {
                granted.insert(implied);
            }
        }
    }
    required.iter().all(|s| granted.contains(s))
}

fn is_true(o: &DslOutcome) -> bool {
    o.code == "EVALUATION_TRUE"
}

/// Validate a SIGNED CAL against the snapshot and execution trace, producing the
/// lifecycle events and terminal outcome. `cal_hash_hex` is opaque (echoed into
/// every event's `cal_hash`).
/// Parsed CAL context shared by the two lifecycle phases (mirrors makeValidator in validate.ts).
struct Ctx<'a> {
    cal: &'a JcsValue,
    cal_hash_hex: &'a str,
    snapshot: &'a JcsValue,
    trace: &'a ExecutionTrace,
    agent: String,
    action: String,
    nonce: U256,
    expiration: U256,
    tick: U256,
    fee: U256,
    bounded_mode: bool,
    max_gas: U256,
    owner_auth: U256,
}

fn build_ctx<'a>(cal: &'a JcsValue, cal_hash_hex: &'a str, snapshot: &'a JcsValue, trace: &'a ExecutionTrace) -> Ctx<'a> {
    let agent = get_in(cal, &["agent_id"]).and_then(JcsValue::as_str).unwrap_or("").to_string();
    let action = get_in(cal, &["action"]).and_then(JcsValue::as_str).unwrap_or("").to_string();
    let nonce = as_big(get_in(cal, &["nonce"]), U256::ZERO);
    let expiration = as_big(get_in(cal, &["expiration_tick"]), U256::ZERO);
    let tick = trace.current_tick;
    let fee = flat_validation_fee(snapshot);
    let bounded_mode = matches!(get_in(snapshot, &["failure_mode", "is_bounded_mode"]), Some(JcsValue::Bool(true)));
    let max_gas = max_expected_dynamic_gas(cal, fee);
    // PFC2-M4 §9.2: owner-authorization gas, linear in k = owner signatures verified. k = 0 for
    // non-owner actions (operator-only path → exact v1 cost); 1 for a v1 single-owner record; the
    // verified-signer count for a v2 owners[] record. v1 and migrated 1-of-1 both yield k = 1 (SC-4).
    let owner_auth = if is_owner_required(&action) || bounded_mode {
        let k = match get_in(snapshot, &["registry", "agents", &agent, "owners"]) {
            Some(JcsValue::Array(_)) => trace
                .owner_signers
                .as_ref()
                .map(|s| s.iter().filter(|x| !x.is_empty()).count() as u64)
                .unwrap_or(0),
            _ => 1,
        };
        owner_auth_units(k)
    } else {
        U256::ZERO
    };
    Ctx { cal, cal_hash_hex, snapshot, trace, agent, action, nonce, expiration, tick, fee, bounded_mode, max_gas, owner_auth }
}

/// PFC2-M1 §2: the multisig owner-authorization quorum check. Pure over the presented signer set.
/// Structural failures (cardinality / non-owner / duplicate / unsorted) → INVALID_SIGNATURE_SET,
/// checked BEFORE the quorum count (< threshold → QUORUM_NOT_MET). Registry owners/threshold are
/// assumed well-formed (reducer-enforced, PFC2-M3). Mirrors `multisigQuorum`.
fn multisig_quorum(owners: &[&str], threshold: U256, signers: &[String]) -> Option<(&'static str, String)> {
    if signers.len() > owners.len() {
        return Some(("INVALID_SIGNATURE_SET", format!("cardinality {} > owners {}", signers.len(), owners.len())));
    }
    for s in signers {
        if s.is_empty() || !owners.iter().any(|o| *o == s.as_str()) {
            return Some(("INVALID_SIGNATURE_SET", "non-owner signer".to_string()));
        }
    }
    for i in 1..signers.len() {
        if signers[i] == signers[i - 1] {
            return Some(("INVALID_SIGNATURE_SET", "duplicate signer".to_string()));
        }
        if signers[i] < signers[i - 1] {
            return Some(("INVALID_SIGNATURE_SET", "owner_sigs not sorted by matched pubkey".to_string()));
        }
    }
    if U256::from_u64(signers.len() as u64) < threshold {
        return Some(("QUORUM_NOT_MET", format!("got {} of {} owner signatures", signers.len(), threshold.to_dec_str())));
    }
    None
}

fn mk_take(events: &mut Vec<JcsValue>, stage: &'static str, reason: Option<&'static str>, detail: String, bill: GasBill) -> ValidationResult {
    ValidationResult { events: std::mem::take(events), terminal_stage: stage, reason_code: reason, reason_detail: detail, bill }
}

/// Phase A — pre-VALIDATED gates (§1–7), then emit cal.validated. Returns
/// `Ok(Some(terminal))` on a pre-validation failure, `Ok(None)` on reaching VALIDATED.
fn phase_a(c: &Ctx, events: &mut Vec<JcsValue>) -> Result<Option<ValidationResult>, GasError> {
    // 1. action registered (§2.3) — malformed, §9.1 ingress-class, no charge
    if !is_registered_action(&c.action) {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "UNKNOWN_ACTION", "action not in §2.3 registry", GasOutcome::FailedNoCharge)?));
    }

    // 1.25. §4.4 MCP schema-hash pin — system-level fault → no-charge (ingress-class).
    if !c.trace.pinned_mcp_schema_hash.is_empty() {
        let state_schema = get_in(c.snapshot, &["registry", "mcp_schema_hash"]).and_then(JcsValue::as_str).unwrap_or("");
        if state_schema != c.trace.pinned_mcp_schema_hash {
            return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "SCHEMA_MISMATCH", "pinned mcp_schema_hash != state", GasOutcome::FailedNoCharge)?));
        }
    }

    // 1.5. §10.2 Bounded-Mode admission gate — no-charge (ingress-class).
    if c.bounded_mode && !is_bounded_allowed(&c.action) {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "BOUNDED_BLOCKED", "action not in §10.2 Bounded-Mode whitelist", GasOutcome::FailedNoCharge)?));
    }

    // 2. expiration before VALIDATED (§3.4) — no PTRA
    if c.tick > c.expiration {
        let bill = settle(GasOutcome::ExpiredPre, c.cal, c.snapshot, &U256::ZERO, &U256::ZERO)?;
        let mut p = id_pairs(c.cal_hash_hex, &c.agent, &c.nonce);
        p.extend([("event_type", si("cal.expired")), ("tick_expired", ii(&c.tick)), ("gas_consumed_ptra", ii(&U256::ZERO)), ("ton_ingress_fee_paid", ii(&U256::ZERO))]);
        events.push(JcsValue::object(p));
        return Ok(Some(mk_take(events, "EXPIRED", None, "expired before VALIDATED".into(), bill)));
    }

    // 3. nonce (§6.2) — malformed/replay, §9.1 ingress-class, no charge
    let expected = as_big(get_in(c.snapshot, &["cal", "nonces", &c.agent]), U256::ZERO).checked_add(&U256::from_u64(1)).expect("nonce overflow");
    if c.nonce != expected {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "NONCE_MISMATCH", "nonce mismatch", GasOutcome::FailedNoCharge)?));
    }

    // 4. signature presence + pubkey availability (§8.1 two key tiers, §8.2). The trace's
    //    *_sig_present flags carry the node's verifier verdict (real Ed25519 lands upstream in
    //    owner_sig.rs / verifyIngress; validate() is pure over them). §9.4 spam-charge.
    if !c.trace.operator_sig_present {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "CAPABILITY_DENIED", "operator_sig required", GasOutcome::FailedPrecond)?));
    }
    let operator_pubkey = get_in(c.snapshot, &["registry", "agents", &c.agent, "operator_pubkey"]).and_then(JcsValue::as_str).unwrap_or("");
    if operator_pubkey.is_empty() {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "CAPABILITY_DENIED", "agent has no operator_pubkey in registry", GasOutcome::FailedPrecond)?));
    }
    let owner_required = is_owner_required(&c.action) || c.bounded_mode;
    if owner_required {
        match get_in(c.snapshot, &["registry", "agents", &c.agent, "owners"]) {
            Some(JcsValue::Array(owners_arr)) => {
                // PFC2-M2 §2: multi-owner (AuthorizationSet v2) quorum gate.
                let owners: Vec<&str> = owners_arr.iter().filter_map(JcsValue::as_str).collect();
                if owners.is_empty() {
                    return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "CAPABILITY_DENIED", "agent has no owners in registry", GasOutcome::FailedPrecond)?));
                }
                let threshold = as_big(get_in(c.snapshot, &["registry", "agents", &c.agent, "threshold"]), U256::ZERO);
                let empty: Vec<String> = Vec::new();
                let signers = c.trace.owner_signers.as_ref().unwrap_or(&empty);
                if let Some((code, detail)) = multisig_quorum(&owners, threshold, signers) {
                    return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, code, &detail, GasOutcome::FailedPrecond)?));
                }
            }
            _ => {
                // v1 single-owner envelope (legacy; migration to owners[] is PFC2-M3).
                if !c.trace.owner_sig_present {
                    return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "CAPABILITY_DENIED", "owner_sig required", GasOutcome::FailedPrecond)?));
                }
                let owner_pubkey = get_in(c.snapshot, &["registry", "agents", &c.agent, "owner_pubkey"]).and_then(JcsValue::as_str).unwrap_or("");
                if owner_pubkey.is_empty() {
                    return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "CAPABILITY_DENIED", "agent has no owner_pubkey in registry", GasOutcome::FailedPrecond)?));
                }
            }
        }
    }

    // 5. scope grant (§4.3) — §9.4 spam charge
    if !capability_grants(c.snapshot, &c.agent, &c.action) {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "CAPABILITY_DENIED", "agent lacks required scope", GasOutcome::FailedPrecond)?));
    }

    // 6. preconditions — PRECOND_FALSE retains the §9.4 fee; PRECOND_ERROR is ingress-class, no charge
    let pre = eval_expr(get_in(c.cal, &["preconditions"]), Scope::Precondition, &Bindings { state: Some(c.snapshot.clone()), ..Default::default() });
    if !is_true(&pre) {
        let (reason, outcome) = if pre.code == "EVALUATION_FALSE" {
            ("PRECOND_FALSE", GasOutcome::FailedPrecond)
        } else {
            ("PRECOND_ERROR", GasOutcome::FailedNoCharge)
        };
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, reason, "preconditions not satisfied", outcome)?));
    }

    // 7. escrow gate (§9.3) — §3.5 INSUFFICIENT_ESCROW, distinct from gate-11 OUT_OF_GAS.
    if !can_validate(c.cal, c.snapshot) {
        return Ok(Some(pre_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "INSUFFICIENT_ESCROW", "balance < escrow (§9.3)", GasOutcome::FailedNoCharge)?));
    }

    // --- cal.validated: §9.3 upfront deposit — escrow = fee + Max_Expected_Dynamic_Gas.
    {
        let mut p = id_pairs(c.cal_hash_hex, &c.agent, &c.nonce);
        p.push(("event_type", si("cal.validated")));
        p.push(("escrow_ptra", ii(&c.fee.checked_add(&c.max_gas).expect("escrow overflow"))));
        events.push(JcsValue::object(p));
    }
    Ok(None)
}

/// Phase B — post-VALIDATED gates (§8–13) → terminal. Assumes VALIDATED reached.
/// EXPIRED_POST fires when tick > expiration (only under multi-tick staging).
fn phase_b(c: &Ctx, events: &mut Vec<JcsValue>) -> Result<ValidationResult, GasError> {
    // 8. expiration recheck
    if c.tick > c.expiration {
        let bill = settle(GasOutcome::ExpiredPost, c.cal, c.snapshot, &U256::ZERO, &U256::ZERO)?;
        let mut p = id_pairs(c.cal_hash_hex, &c.agent, &c.nonce);
        p.extend([("event_type", si("cal.expired")), ("tick_expired", ii(&c.tick)), ("gas_consumed_ptra", ii(&U256::ZERO)), ("gas_refunded_ptra", ii(&bill.gas_refunded)), ("ton_ingress_fee_paid", ii(&U256::ZERO))]);
        events.push(JcsValue::object(p));
        return Ok(mk_take(events, "EXPIRED", None, "expired after VALIDATED".into(), bill));
    }

    // 9–10. steps
    let steps: Vec<JcsValue> = match get_in(c.cal, &["steps"]) {
        Some(JcsValue::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let mut committed: Vec<JcsValue> = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let tr = c.trace.steps.get(i);
        if tr.map(|t| t.ok) != Some(true) {
            let detail = tr.and_then(|t| t.error_detail.clone()).unwrap_or_else(|| format!("step {i} failed"));
            return exec_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "STEP_ERROR", &detail, &committed, &c.owner_auth);
        }
        committed.extend(tr.unwrap().effects.iter().cloned());
        if let Some(JcsValue::Array(pcs)) = get_in(step, &["post_conditions"]) {
            let params = get_in(step, &["params"]).cloned();
            for pc in pcs {
                let b = Bindings { before: Some(c.trace.state_before.clone()), after: Some(c.trace.state_after.clone()), params: params.clone(), ..Default::default() };
                let o = eval_expr(Some(pc), Scope::PostCondition, &b);
                if !is_true(&o) {
                    let reason = if o.code == "EVALUATION_FALSE" { "POSTCOND_FALSE" } else { "STEP_ERROR" };
                    return exec_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, reason, "post_condition not satisfied", &committed, &c.owner_auth);
                }
            }
        }
    }

    // 11. dynamic gas vs budget (§9.3)
    let bytes_written = effects_bytes(&JcsValue::Array(committed.clone()))?;
    let raw_gas = to_nano(gas_units(c.cal, &bytes_written, &c.owner_auth)?, gas_price(c.snapshot));
    if raw_gas > c.max_gas {
        return exec_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "OUT_OF_GAS", "dynamic gas exceeds budget", &committed, &c.owner_auth);
    }
    let consumed = raw_gas;

    // --- cal.executed ---
    {
        let mut p = id_pairs(c.cal_hash_hex, &c.agent, &c.nonce);
        p.push(("event_type", si("cal.executed")));
        p.push(("effects", JcsValue::Array(committed.clone())));
        p.push(("gas_consumed_ptra", ii(&consumed)));
        events.push(JcsValue::object(p));
    }

    // 12. expiration recheck (defensive)
    if c.tick > c.expiration {
        let bill = settle(GasOutcome::ExpiredPost, c.cal, c.snapshot, &U256::ZERO, &U256::ZERO)?;
        let mut p = id_pairs(c.cal_hash_hex, &c.agent, &c.nonce);
        p.extend([("event_type", si("cal.expired")), ("tick_expired", ii(&c.tick)), ("gas_consumed_ptra", ii(&U256::ZERO)), ("gas_refunded_ptra", ii(&bill.gas_refunded)), ("ton_ingress_fee_paid", ii(&U256::ZERO))]);
        events.push(JcsValue::object(p));
        return Ok(mk_take(events, "EXPIRED", None, "expired after VALIDATED".into(), bill));
    }

    // 13. invariants — Bounded Mode appends the DSL §7.1 / CAL §10.3 emergency set.
    let declared: Vec<JcsValue> = match get_in(c.cal, &["invariants"]) {
        Some(JcsValue::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let invariants: Vec<JcsValue> = effective_invariants(&declared, c.bounded_mode);
    for inv in &invariants {
        let b = Bindings { before: Some(c.trace.state_before.clone()), after: Some(c.trace.state_after.clone()), ..Default::default() };
        let o = eval_expr(Some(inv), Scope::Invariant, &b);
        if !is_true(&o) {
            return exec_fail(events, c.cal, c.snapshot, c.cal_hash_hex, &c.agent, &c.nonce, &c.tick, "INVARIANT_FALSE", "invariant not satisfied", &committed, &c.owner_auth);
        }
    }

    // --- cal.settled + cal.finalized ---
    events.push(JcsValue::object(vec![("event_type", si("cal.settled")), ("cal_hash", si(c.cal_hash_hex))]));
    let bill = settle(GasOutcome::Finalized, c.cal, c.snapshot, &bytes_written, &c.owner_auth)?;
    {
        let mut p = id_pairs(c.cal_hash_hex, &c.agent, &c.nonce);
        p.extend([
            ("event_type", si("cal.finalized")),
            ("tick_finalized", ii(&c.tick)),
            ("gas_consumed_ptra", ii(&consumed)),
            ("gas_refunded_ptra", ii(&bill.gas_refunded)),
            ("steps_applied", ii(&U256::from_u64(steps.len() as u64))),
            ("invariants_checked", ii(&U256::from_u64(invariants.len() as u64))),
        ]);
        events.push(JcsValue::object(p));
    }
    Ok(mk_take(events, "FINALIZED", None, String::new(), bill))
}

/// Atomic composition of [`validate_to_validated`] + [`resume_from_validated`] (Gate #3):
/// byte-identical to the pre-staging monolith. The staged pair lets the orchestrator split a
/// CAL's lifecycle across ticks, making EXPIRED_POST and AGENT_BUSY reachable.
pub fn validate(cal: &JcsValue, cal_hash_hex: &str, snapshot: &JcsValue, trace: &ExecutionTrace) -> Result<ValidationResult, GasError> {
    let c = build_ctx(cal, cal_hash_hex, snapshot, trace);
    let mut events: Vec<JcsValue> = Vec::new();
    if let Some(term) = phase_a(&c, &mut events)? {
        return Ok(term);
    }
    phase_b(&c, &mut events)
}

/// Stage-1 result: `terminal` set on a pre-validation failure (its events the failure event),
/// else `events` = `[cal.validated]` and the CAL is left in-flight at VALIDATED.
pub struct ToValidated {
    pub terminal: Option<ValidationResult>,
    pub events: Vec<JcsValue>,
}

/// Stage 1 (§ gates 1–7 → cal.validated).
pub fn validate_to_validated(cal: &JcsValue, cal_hash_hex: &str, snapshot: &JcsValue, trace: &ExecutionTrace) -> Result<ToValidated, GasError> {
    let c = build_ctx(cal, cal_hash_hex, snapshot, trace);
    let mut events: Vec<JcsValue> = Vec::new();
    match phase_a(&c, &mut events)? {
        Some(term) => {
            let evs = term.events.clone();
            Ok(ToValidated { terminal: Some(term), events: evs })
        }
        None => Ok(ToValidated { terminal: None, events }),
    }
}

/// Stage 2 (§ gates 8–13). Resumes a VALIDATED CAL → terminal; EXPIRED_POST when tick > expiration.
pub fn resume_from_validated(cal: &JcsValue, cal_hash_hex: &str, snapshot: &JcsValue, trace: &ExecutionTrace) -> Result<ValidationResult, GasError> {
    let c = build_ctx(cal, cal_hash_hex, snapshot, trace);
    let mut events: Vec<JcsValue> = Vec::new();
    phase_b(&c, &mut events)
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
    let bill = settle(outcome, cal, snapshot, &U256::ZERO, &U256::ZERO)?;
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
    owner_auth: &U256,
) -> Result<ValidationResult, GasError> {
    let bytes_written = effects_bytes(&JcsValue::Array(committed.to_vec()))?;
    let bill = settle(GasOutcome::FailedExec, cal, snapshot, &bytes_written, owner_auth)?;
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
