//! Byte-for-byte parity against the TypeScript reference golden vectors
//! (`../orchestrator/vectors/golden.json`): for each program, the full canonical
//! event log, per-tick STATE_ROOT + global Merkle root, and per-submission terminal
//! stage / reason code / event types / per-event STATE_ROOTs. Programs are
//! reconstructed from the stored canonical start state + per-submission CAL/trace.

use paradigm_terra_cal_gas::U256;
use paradigm_terra_cal_validator::{ExecutionTrace, StepResult};
use paradigm_terra_canonical::jcs::{canonicalize_value, parse_canonical, JcsValue};
use paradigm_terra_orchestrator::{run, Program, Submission, TickBlock};

const GOLDEN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../orchestrator/vectors/golden.json"));

fn gstr(v: &JcsValue, key: &str) -> Option<String> {
    match v.get(key) {
        Some(JcsValue::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

fn strs(v: &JcsValue, key: &str) -> Vec<String> {
    match v.get(key) {
        Some(JcsValue::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        _ => Vec::new(),
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
        current_tick: match j.get("current_tick") {
            Some(JcsValue::Int(s)) => U256::from_dec_str(s).unwrap_or(U256::ZERO),
            _ => U256::ZERO,
        },
        steps,
        state_before: j.get("state_before").cloned().unwrap_or(JcsValue::Null),
        state_after: j.get("state_after").cloned().unwrap_or(JcsValue::Null),
        owner_sig_present: matches!(j.get("owner_sig_present"), Some(JcsValue::Bool(true))),
        pinned_mcp_schema_hash: j.get("pinned_mcp_schema_hash").and_then(JcsValue::as_str).unwrap_or("").to_string(),
    }
}

fn ser(ev: &JcsValue) -> String {
    String::from_utf8(canonicalize_value(ev).expect("serialize event")).expect("utf8")
}

#[test]
fn parity_with_typescript_golden_vectors() {
    let doc = parse_canonical(GOLDEN).expect("parse golden.json");
    let programs = doc.get("programs").and_then(JcsValue::as_array).expect("programs array");
    assert!(programs.len() >= 3, "expected at least 3 orchestrator programs");

    let mut results: Vec<(bool, String)> = Vec::new();

    for p in programs {
        let id = p.get("id").and_then(JcsValue::as_str).unwrap_or("<no id>");
        let genesis_state = parse_canonical(gstr(p, "start_state_canonical").as_deref().unwrap()).expect("start state");
        let in_ticks = p.get("input_ticks").and_then(JcsValue::as_array).expect("input_ticks");

        let ticks: Vec<TickBlock> = in_ticks
            .iter()
            .map(|blk| TickBlock {
                tick: U256::from_dec_str(blk.get("tick").and_then(JcsValue::as_str).unwrap()).unwrap(),
                submissions: blk
                    .get("submissions")
                    .and_then(JcsValue::as_array)
                    .unwrap()
                    .iter()
                    .map(|s| Submission {
                        cal: parse_canonical(gstr(s, "cal_canonical").as_deref().unwrap()).expect("cal"),
                        trace: build_trace(&parse_canonical(gstr(s, "trace_canonical").as_deref().unwrap()).expect("trace")),
                    })
                    .collect(),
            })
            .collect();

        let t = run(&Program { genesis_state, ticks }).expect("run");
        let exp = p.get("expected").expect("expected");

        let got_log: Vec<String> = t.event_log.iter().map(ser).collect();
        results.push((got_log == strs(exp, "event_log"), format!("{id}: event_log")));
        results.push((t.final_state_root == gstr(exp, "final_state_root").unwrap_or_default(), format!("{id}: final_state_root")));

        let exp_ticks = exp.get("ticks").and_then(JcsValue::as_array).unwrap();
        results.push((t.ticks.len() == exp_ticks.len(), format!("{id}: tick count")));
        for (k, (tk, gk)) in t.ticks.iter().zip(exp_ticks).enumerate() {
            results.push((tk.tick.to_dec_str() == gk.get("tick").and_then(JcsValue::as_str).unwrap_or(""), format!("{id} t{k}: tick")));
            results.push((tk.state_root == gstr(gk, "state_root").unwrap_or_default(), format!("{id} t{k}: state_root")));
            results.push((tk.global_merkle_root == gstr(gk, "global_merkle_root").unwrap_or_default(), format!("{id} t{k}: global_merkle_root")));
            let gsubs = gk.get("submissions").and_then(JcsValue::as_array).unwrap();
            results.push((tk.submissions.len() == gsubs.len(), format!("{id} t{k}: sub count")));
            for (j, (s, gs)) in tk.submissions.iter().zip(gsubs).enumerate() {
                results.push((s.cal_hash == gstr(gs, "cal_hash").unwrap_or_default(), format!("{id} t{k} s{j}: cal_hash")));
                results.push((s.terminal_stage.as_deref() == gs.get("terminal_stage").and_then(JcsValue::as_str), format!("{id} t{k} s{j}: terminal_stage")));
                results.push((s.reason_code.as_deref() == gs.get("reason_code").and_then(JcsValue::as_str), format!("{id} t{k} s{j}: reason_code")));
                results.push((s.event_types == strs(gs, "event_types"), format!("{id} t{k} s{j}: event_types")));
                results.push((s.state_roots == strs(gs, "state_roots"), format!("{id} t{k} s{j}: state_roots")));
            }
        }
    }

    let checks = results.len();
    let fails: Vec<String> = results.into_iter().filter(|(ok, _)| !ok).map(|(_, m)| m).collect();
    if !fails.is_empty() {
        panic!("{} parity failures:\n{}", fails.len(), fails.join("\n"));
    }
    println!("All {checks} orchestrator parity checks passed against TypeScript golden vectors.");
}
