//! CAL wire-format structural validation (mirrors `schema.ts`, §2.1).
//!
//! Validates only what is decidable from the blob alone: field types, registered
//! action/verb taxonomy, canonical address, uint ranges, and that every embedded
//! DSL expression *parses* at its scope. No evaluation, no signature crypto, no
//! nonce/expiration/capability checks. Check order + codes match the TS reference.

use paradigm_terra_canonical::addresses::is_canonical_address;
use paradigm_terra_canonical::jcs::JcsValue;
use paradigm_terra_dsl::taxonomy::is_registered_action;
use paradigm_terra_dsl::{parse_expression, Scope, Version};

use crate::errors::{CalError, CheckResult};

pub const CAL_VERSION: &str = "0.1.0";

const TOP_LEVEL_KEYS: &[&str] = &[
    "cal_version", "action", "agent_id", "nonce", "expiration_tick", "preconditions", "invariants",
    "steps", "receipt_required", "signatures", "compatibility_pragma", "gas_limit_ptra",
];
const REQUIRED_FIELDS: &[&str] = &[
    "cal_version", "action", "agent_id", "nonce", "expiration_tick", "preconditions", "invariants",
    "steps", "receipt_required", "signatures",
];
const STEP_KEYS: &[&str] = &["verb", "params", "post_conditions"];
const SIG_KEYS: &[&str] = &["operator_sig", "owner_sig", "sponsor_sig"];
const OWNER_ENVELOPE_KEYS: &[&str] = &["signature", "domain", "timestamp", "workchain", "address_hash"];

fn pairs_of<'a>(v: &'a JcsValue) -> Option<&'a Vec<(String, JcsValue)>> {
    match v {
        JcsValue::Object(p) => Some(p),
        _ => None,
    }
}

fn check_unexpected(pairs: &[(String, JcsValue)], allowed: &[&str], code: &'static str) -> Result<(), CalError> {
    for (k, _) in pairs {
        if !allowed.contains(&k.as_str()) {
            return Err(CalError::with(code, k.clone()));
        }
    }
    Ok(())
}

fn is_u64(v: Option<&JcsValue>) -> bool {
    matches!(v, Some(JcsValue::Int(s)) if s.parse::<u64>().is_ok())
}

fn is_nonneg_int(v: Option<&JcsValue>) -> bool {
    matches!(v, Some(JcsValue::Int(s)) if !s.starts_with('-'))
}

fn is_hex_bytes(s: &str) -> bool {
    s.starts_with("0x") && (s.len() - 2) % 2 == 0 && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_embedded(node: &JcsValue, scope: Scope, where_: &str) -> Result<(), CalError> {
    let mut version = Version::V12;
    let mut expr = node;
    if let JcsValue::Object(pairs) = node {
        if pairs.iter().any(|(k, _)| k == "dsl_version") {
            if let Some(v) = node.get("dsl_version").and_then(|x| x.as_str()) {
                version = Version::from_str(v).unwrap_or(Version::V12);
            }
            if let Some(e) = node.get("expr") {
                expr = e;
            }
        }
    }
    match parse_expression(expr, scope, version) {
        Ok(_) => Ok(()),
        Err(e) => Err(CalError::with("DSL_INVALID", format!("{}: {}/{}", where_, e.phase.code(), e.reason))),
    }
}

fn validate_signatures(sig: &JcsValue) -> Result<(), CalError> {
    let pairs = pairs_of(sig).ok_or_else(|| CalError::code("BAD_SIGNATURES"))?;
    check_unexpected(pairs, SIG_KEYS, "UNEXPECTED_SIG_FIELD")?;
    if sig.get("operator_sig").is_none() {
        return Err(CalError::with("MISSING_FIELD", "signatures.operator_sig".into()));
    }
    // operator_sig / sponsor_sig: raw hex Ed25519 bytes.
    for k in ["operator_sig", "sponsor_sig"] {
        if let Some(v) = sig.get(k) {
            match v.as_str() {
                Some(s) if is_hex_bytes(s) => {}
                _ => return Err(CalError::with("BAD_SIG_BYTES", format!("signatures.{k}"))),
            }
        }
    }
    // owner_sig: legacy hex string OR the Contract A reconstruction envelope object
    // (dual-accept, §8.4 Tier-2 window; D-S1/D-S2).
    if let Some(v) = sig.get("owner_sig") {
        if let Some(s) = v.as_str() {
            if !is_hex_bytes(s) {
                return Err(CalError::with("BAD_SIG_BYTES", "signatures.owner_sig".into()));
            }
        } else {
            let env = pairs_of(v).ok_or_else(|| CalError::code("BAD_OWNER_ENVELOPE"))?;
            check_unexpected(env, OWNER_ENVELOPE_KEYS, "UNEXPECTED_OWNER_ENVELOPE_FIELD")?;
            for k in OWNER_ENVELOPE_KEYS {
                if v.get(k).is_none() {
                    return Err(CalError::with("MISSING_FIELD", format!("signatures.owner_sig.{k}")));
                }
            }
            match v.get("signature").and_then(|x| x.as_str()) {
                Some(s) if is_hex_bytes(s) => {}
                _ => return Err(CalError::with("BAD_SIG_BYTES", "signatures.owner_sig.signature".into())),
            }
            // address_hash: 0x + exactly 32 bytes (reconstruction primitive, not friendly form).
            match v.get("address_hash").and_then(|x| x.as_str()) {
                Some(s) if is_hex_bytes(s) && s.len() == 66 => {}
                _ => return Err(CalError::with("BAD_OWNER_ENVELOPE", "signatures.owner_sig.address_hash".into())),
            }
            match v.get("domain").and_then(|x| x.as_str()) {
                Some(s) if !s.is_empty() => {}
                _ => return Err(CalError::with("BAD_OWNER_ENVELOPE", "signatures.owner_sig.domain".into())),
            }
            if !is_u64(v.get("timestamp")) {
                return Err(CalError::with("BAD_OWNER_ENVELOPE", "signatures.owner_sig.timestamp".into()));
            }
            // workchain: int32 (signed).
            match v.get("workchain") {
                Some(JcsValue::Int(s)) if s.parse::<i64>().map(|n| (-(1i64 << 31)..=(1i64 << 31) - 1).contains(&n)).unwrap_or(false) => {}
                _ => return Err(CalError::with("BAD_OWNER_ENVELOPE", "signatures.owner_sig.workchain".into())),
            }
        }
    }
    Ok(())
}

fn validate_step(step: &JcsValue, namespace: &str, where_: &str) -> Result<(), CalError> {
    let pairs = pairs_of(step).ok_or_else(|| CalError::code("BAD_STEP"))?;
    check_unexpected(pairs, STEP_KEYS, "UNEXPECTED_STEP_FIELD")?;
    let verb = match step.get("verb").and_then(|x| x.as_str()) {
        Some(v) => v,
        None => return Err(CalError::with("BAD_STEP", format!("{where_}.verb"))),
    };
    if !is_registered_action(verb) {
        return Err(CalError::with("UNKNOWN_VERB", verb.to_string()));
    }
    if verb.split('.').next() != Some(namespace) {
        return Err(CalError::with("VERB_NAMESPACE_MISMATCH", format!("{verb} not in {namespace}.*")));
    }
    if pairs_of(step.get("params").unwrap_or(&JcsValue::Null)).is_none() {
        return Err(CalError::code("BAD_PARAMS"));
    }
    if let Some(pcs) = step.get("post_conditions") {
        let arr = pcs.as_array().ok_or_else(|| CalError::with("POSTCONDITIONS_NOT_LIST", where_.to_string()))?;
        for (i, pc) in arr.iter().enumerate() {
            validate_embedded(pc, Scope::PostCondition, &format!("{where_}.post_conditions[{i}]"))?;
        }
    }
    Ok(())
}

fn validate(cal: &JcsValue) -> Result<(), CalError> {
    let pairs = pairs_of(cal).ok_or_else(|| CalError::code("NOT_OBJECT"))?;
    check_unexpected(pairs, TOP_LEVEL_KEYS, "UNEXPECTED_FIELD")?;

    for f in REQUIRED_FIELDS {
        if cal.get(f).is_none() {
            return Err(CalError::with("MISSING_FIELD", (*f).to_string()));
        }
    }

    if cal.get("cal_version").and_then(|x| x.as_str()) != Some(CAL_VERSION) {
        return Err(CalError::with("BAD_CAL_VERSION", cal.get("cal_version").and_then(|x| x.as_str()).unwrap_or("").to_string()));
    }

    let action = match cal.get("action").and_then(|x| x.as_str()) {
        Some(a) if is_registered_action(a) => a,
        other => return Err(CalError::with("UNKNOWN_ACTION", other.unwrap_or("").to_string())),
    };
    let namespace = action.split('.').next().unwrap_or("");

    match cal.get("agent_id").and_then(|x| x.as_str()) {
        Some(a) if is_canonical_address(a) => {}
        _ => return Err(CalError::code("BAD_AGENT_ID")),
    }

    if !is_u64(cal.get("nonce")) {
        return Err(CalError::code("BAD_NONCE"));
    }
    if !is_u64(cal.get("expiration_tick")) {
        return Err(CalError::code("BAD_EXPIRATION"));
    }

    validate_embedded(cal.get("preconditions").unwrap(), Scope::Precondition, "preconditions")?;

    let invariants = cal.get("invariants").and_then(|x| x.as_array()).ok_or_else(|| CalError::code("INVARIANTS_NOT_LIST"))?;
    for (i, inv) in invariants.iter().enumerate() {
        validate_embedded(inv, Scope::Invariant, &format!("invariants[{i}]"))?;
    }

    let steps = cal.get("steps").and_then(|x| x.as_array()).ok_or_else(|| CalError::code("STEPS_NOT_LIST"))?;
    if steps.is_empty() {
        return Err(CalError::code("EMPTY_STEPS"));
    }
    for (i, s) in steps.iter().enumerate() {
        validate_step(s, namespace, &format!("steps[{i}]"))?;
    }

    if !matches!(cal.get("receipt_required"), Some(JcsValue::Bool(_))) {
        return Err(CalError::code("BAD_RECEIPT_REQUIRED"));
    }

    validate_signatures(cal.get("signatures").unwrap())?;

    if let Some(p) = cal.get("compatibility_pragma") {
        if p.as_str() != Some("v0.9.5") {
            return Err(CalError::with("BAD_PRAGMA", p.as_str().unwrap_or("").to_string()));
        }
    }
    if cal.get("gas_limit_ptra").is_some() && !is_nonneg_int(cal.get("gas_limit_ptra")) {
        return Err(CalError::code("BAD_GAS_LIMIT"));
    }

    Ok(())
}

/// Validate a CAL; returns a stable {valid, code, detail} outcome.
pub fn check_cal(cal: &JcsValue) -> CheckResult {
    match validate(cal) {
        Ok(()) => CheckResult { valid: true, code: None, detail: None },
        Err(e) => CheckResult { valid: false, code: Some(e.code), detail: e.detail },
    }
}
