//! Differential-fuzz harness for the Rust parity reducer.
//!
//! Shares the line protocol documented in `cal-reducer/fuzz/ts_harness.mjs`:
//!   stdin  : one case per line — hex of canonical-JSON { "start", "events":[...] }.
//!   stdout : "OK <hex-state-root>" / "ERR <CODE>@<index>" / "ERR BADCASE", in order.

use std::io::{self, Read, Write};

use paradigm_terra_cal_reducer::{materialize, state_root_of};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};

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
    let events: Vec<JcsValue> = match doc.get("events").and_then(|v| v.as_array()) {
        Some(a) => a.to_vec(),
        None => return "ERR BADCASE".to_string(),
    };
    let start = doc.get("start").cloned().unwrap_or(JcsValue::Null);
    match materialize(&events, start) {
        Ok(state) => match state_root_of(&state) {
            Ok(r) => format!("OK {}", hex::encode(r)),
            Err(_) => "ERR BADCASE".to_string(),
        },
        Err((code, idx)) => format!("ERR {code}@{idx}"),
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
