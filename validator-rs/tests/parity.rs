//! Byte-for-byte parity against the TypeScript reference golden vectors
//! (`../validator/vectors/golden.json`): for each (cal, snapshot, trace), the
//! emitted event_type sequence, terminal stage, reason code, the economic event
//! fields, and the full §9.4 bill.

use paradigm_terra_cal_gas::{as_big, U256};
use paradigm_terra_cal_validator::{validate, ExecutionTrace, StepResult};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};

const GOLDEN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../validator/vectors/golden.json"));

fn gstr(v: &JcsValue, key: &str) -> Option<String> {
    match v.get(key) {
        Some(JcsValue::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

fn build_trace(j: &JcsValue) -> ExecutionTrace {
    let steps = match j.get("steps") {
        Some(JcsValue::Array(a)) => a
            .iter()
            .map(|s| StepResult {
                ok: matches!(s.get("ok"), Some(JcsValue::Bool(true))),
                effects: match s.get("effects") {
                    Some(JcsValue::Array(e)) => e.clone(),
                    _ => Vec::new(),
                },
                error_detail: s.get("error_detail").and_then(JcsValue::as_str).map(str::to_string),
            })
            .collect(),
        _ => Vec::new(),
    };
    ExecutionTrace {
        current_tick: as_big(j.get("current_tick"), U256::ZERO),
        steps,
        state_before: j.get("state_before").cloned().unwrap_or(JcsValue::Null),
        state_after: j.get("state_after").cloned().unwrap_or(JcsValue::Null),
        owner_sig_present: matches!(j.get("owner_sig_present"), Some(JcsValue::Bool(true))),
    }
}

/// Decimal-string value of `key` in the first event of type `etype`, if present.
fn ev_int(events: &[JcsValue], etype: &str, key: &str) -> Option<String> {
    events
        .iter()
        .find(|e| e.get("event_type").and_then(JcsValue::as_str) == Some(etype))
        .and_then(|e| e.get(key))
        .and_then(|v| match v {
            JcsValue::Int(s) => Some(s.clone()),
            _ => None,
        })
}

#[test]
fn parity_with_typescript_golden_vectors() {
    let doc = parse_canonical(GOLDEN).expect("parse golden.json");
    let vectors = doc.get("vectors").and_then(JcsValue::as_array).expect("vectors array");
    assert!(vectors.len() >= 12, "expected at least 12 validator vectors");

    // (passed, message) per check — counted/filtered after the loop to avoid a
    // closure holding a mutable borrow of the accumulators.
    let mut results: Vec<(bool, String)> = Vec::new();

    for v in vectors {
        let id = v.get("id").and_then(JcsValue::as_str).unwrap_or("<no id>");
        let cal = parse_canonical(gstr(v, "cal_canonical").as_deref().unwrap()).expect("cal");
        let snapshot = parse_canonical(gstr(v, "snapshot_canonical").as_deref().unwrap()).expect("snapshot");
        let trace = build_trace(&parse_canonical(gstr(v, "trace_canonical").as_deref().unwrap()).expect("trace"));
        let cal_hash = gstr(v, "cal_hash").unwrap();
        let out = v.get("output").expect("output");

        let res = validate(&cal, &cal_hash, &snapshot, &trace).expect("validate");

        let got_types: Vec<&str> = res.events.iter().map(|e| e.get("event_type").and_then(JcsValue::as_str).unwrap_or("?")).collect();
        let want_types: Vec<&str> = out.get("event_types").and_then(JcsValue::as_array).unwrap().iter().map(|t| t.as_str().unwrap()).collect();
        results.push((got_types == want_types, format!("{id}: event_types got {got_types:?} want {want_types:?}")));

        results.push((Some(res.terminal_stage) == out.get("terminal_stage").and_then(JcsValue::as_str), format!("{id}: terminal_stage")));
        results.push((res.reason_code == out.get("reason_code").and_then(JcsValue::as_str), format!("{id}: reason_code")));

        // §9.3 upfront escrow: cal.validated carries escrow_ptra = fee + Max_Expected_Dynamic_Gas.
        results.push((ev_int(&res.events, "cal.validated", "escrow_ptra") == gstr(out, "escrow_ptra"), format!("{id}: escrow")));
        let terminal = res.events.last().expect("terminal event");
        // §9.4 Tier-2: the spam charge a pre-VALIDATED cal.failed carries (min(fee, balance)).
        let terminal_fee = match terminal.get("fee_debited_ptra") {
            Some(JcsValue::Int(s)) => Some(s.clone()),
            _ => None,
        };
        results.push((terminal_fee == gstr(out, "terminal_fee_debited_ptra"), format!("{id}: terminal_fee_debited")));
        let gas_consumed = match terminal.get("gas_consumed_ptra") {
            Some(JcsValue::Int(s)) => Some(s.clone()),
            _ => None,
        };
        results.push((gas_consumed == gstr(out, "gas_consumed_ptra"), format!("{id}: gas_consumed")));
        // The unused-gas refund the terminal event carries (finalized / post-VALIDATED failed / expired-post).
        let gas_refunded = match terminal.get("gas_refunded_ptra") {
            Some(JcsValue::Int(s)) => Some(s.clone()),
            _ => None,
        };
        results.push((gas_refunded == gstr(out, "gas_refunded_ptra"), format!("{id}: gas_refunded")));

        let bill = out.get("bill").expect("bill");
        results.push((res.bill.fee_retained.to_dec_str() == gstr(bill, "fee_retained").unwrap_or_default(), format!("{id}: bill.fee_retained")));
        results.push((res.bill.dynamic_gas_consumed.to_dec_str() == gstr(bill, "dynamic_gas_consumed").unwrap_or_default(), format!("{id}: bill.consumed")));
        results.push((res.bill.gas_refunded.to_dec_str() == gstr(bill, "gas_refunded").unwrap_or_default(), format!("{id}: bill.refunded")));
        results.push((res.bill.total_agent_charge.to_dec_str() == gstr(bill, "total_agent_charge").unwrap_or_default(), format!("{id}: bill.total")));
    }

    let checks = results.len();
    let fails: Vec<String> = results.into_iter().filter(|(ok, _)| !ok).map(|(_, m)| m).collect();
    if !fails.is_empty() {
        panic!("{} parity failures:\n{}", fails.len(), fails.join("\n"));
    }
    println!("All {checks} validator parity checks passed against TypeScript golden vectors.");
}
