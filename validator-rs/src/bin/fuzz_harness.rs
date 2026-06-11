//! Differential-fuzz harness for the Rust parity validator.
//!
//! Shares the line protocol documented in `validator/fuzz/ts_harness.mjs`:
//!   stdin  : one case per line — hex of canonical-JSON { cal, cal_hash, snapshot, trace }.
//!   stdout : "OK <types>|<stage>|<reason>|<vfee>|<tfee>|<gc>|<gr>|<fr,dg,gr,tac>"
//!            / "ERR BADCASE" / "ERR COMPUTE", in order.

use std::io::{self, Read, Write};

use paradigm_terra_cal_gas::{as_big, U256};
use paradigm_terra_cal_validator::{validate, ExecutionTrace, StepResult};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};

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
        operator_sig_present: matches!(j.get("operator_sig_present"), Some(JcsValue::Bool(true))),
        owner_sig_present: matches!(j.get("owner_sig_present"), Some(JcsValue::Bool(true))),
        owner_signers: match j.get("owner_signers") {
            Some(JcsValue::Array(a)) => Some(a.iter().map(|s| s.as_str().unwrap_or("").to_string()).collect()),
            _ => None,
        },
        pinned_mcp_schema_hash: j.get("pinned_mcp_schema_hash").and_then(JcsValue::as_str).unwrap_or("").to_string(),
    }
}

fn ev_int(events: &[JcsValue], etype: &str, key: &str) -> String {
    events
        .iter()
        .find(|e| e.get("event_type").and_then(JcsValue::as_str) == Some(etype))
        .and_then(|e| match e.get(key) {
            Some(JcsValue::Int(s)) => Some(s.clone()),
            _ => None,
        })
        .unwrap_or_else(|| "-".to_string())
}

fn handle(line: &str) -> String {
    let bytes = match hex::decode(line) {
        Ok(b) => b,
        Err(_) => return "ERR BADCASE".to_string(),
    };
    let text = match String::from_utf8(bytes) {
        Ok(t) => t,
        Err(_) => return "ERR BADCASE".to_string(),
    };
    let doc = match parse_canonical(&text) {
        Ok(d) => d,
        Err(_) => return "ERR BADCASE".to_string(),
    };
    let (cal, snapshot) = match (doc.get("cal"), doc.get("snapshot")) {
        (Some(c), Some(s)) => (c, s),
        _ => return "ERR BADCASE".to_string(),
    };
    let cal_hash = match doc.get("cal_hash").and_then(JcsValue::as_str) {
        Some(h) => h,
        None => return "ERR BADCASE".to_string(),
    };
    let trace = build_trace(doc.get("trace").unwrap_or(&JcsValue::Null));

    match validate(cal, cal_hash, snapshot, &trace) {
        Ok(res) => {
            let types: Vec<&str> = res.events.iter().map(|e| e.get("event_type").and_then(JcsValue::as_str).unwrap_or("?")).collect();
            let term = res.events.last();
            let int_of = |e: Option<&JcsValue>, k: &str| -> String {
                e.and_then(|ev| match ev.get(k) {
                    Some(JcsValue::Int(s)) => Some(s.clone()),
                    _ => None,
                })
                .unwrap_or_else(|| "-".to_string())
            };
            let b = &res.bill;
            format!(
                "OK {}|{}|{}|{}|{}|{}|{}|{},{},{},{}",
                types.join(","),
                res.terminal_stage,
                res.reason_code.unwrap_or("-"),
                ev_int(&res.events, "cal.validated", "escrow_ptra"),
                int_of(term, "fee_debited_ptra"),
                int_of(term, "gas_consumed_ptra"),
                int_of(term, "gas_refunded_ptra"),
                b.fee_retained.to_dec_str(),
                b.dynamic_gas_consumed.to_dec_str(),
                b.gas_refunded.to_dec_str(),
                b.total_agent_charge.to_dec_str()
            )
        }
        Err(_) => "ERR COMPUTE".to_string(),
    }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let stdout = io::stdout();
    let mut w = io::BufWriter::new(stdout.lock());
    for line in input.split('\n') {
        if line.is_empty() {
            continue;
        }
        writeln!(w, "{}", handle(line)).unwrap();
    }
}
