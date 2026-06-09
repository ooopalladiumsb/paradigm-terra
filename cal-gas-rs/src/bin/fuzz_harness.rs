//! Differential-fuzz harness for the Rust parity gas layer.
//!
//! Shares the line protocol documented in `cal-gas/fuzz/ts_harness.mjs`:
//!   stdin  : one case per line — hex of canonical-JSON { cal, state, bytes_written }.
//!   stdout : "OK <su> <gu> <esc> <cv> <FIN> <FP> <FNC> <FE> <EPRE> <EPOST>"
//!            / "ERR BADCASE" / "ERR COMPUTE", in order. Each outcome is the bill
//!            `feeRet,gasCons,gasRef,total`; cv is 1/0; all values decimal uint256.

use std::io::{self, Read, Write};

use paradigm_terra_cal_gas::{
    can_validate, escrow_requirement, gas_units, settle, static_gas_units, GasBill, Outcome, U256,
};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};

const OUTCOMES: [Outcome; 6] = [
    Outcome::Finalized,
    Outcome::FailedPrecond,
    Outcome::FailedNoCharge,
    Outcome::FailedExec,
    Outcome::ExpiredPre,
    Outcome::ExpiredPost,
];

fn quad(b: &GasBill) -> String {
    format!(
        "{},{},{},{}",
        b.fee_retained.to_dec_str(),
        b.dynamic_gas_consumed.to_dec_str(),
        b.gas_refunded.to_dec_str(),
        b.total_agent_charge.to_dec_str()
    )
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
    let (cal, state) = match (doc.get("cal"), doc.get("state")) {
        (Some(c), Some(s)) => (c, s),
        _ => return "ERR BADCASE".to_string(),
    };
    let bytes_written = match doc.get("bytes_written") {
        Some(JcsValue::Int(s)) => match U256::from_dec_str(s) {
            Some(u) => u,
            None => return "ERR BADCASE".to_string(),
        },
        _ => return "ERR BADCASE".to_string(),
    };

    let su = match static_gas_units(cal) {
        Ok(u) => u,
        Err(_) => return "ERR COMPUTE".to_string(),
    };
    let gu = match gas_units(cal, &bytes_written) {
        Ok(u) => u,
        Err(_) => return "ERR COMPUTE".to_string(),
    };
    let esc = escrow_requirement(cal, state);
    let cv = if can_validate(cal, state) { "1" } else { "0" };
    let mut bills = Vec::with_capacity(OUTCOMES.len());
    for o in OUTCOMES {
        match settle(o, cal, state, &bytes_written) {
            Ok(b) => bills.push(quad(&b)),
            Err(_) => return "ERR COMPUTE".to_string(),
        }
    }
    format!("OK {} {} {} {} {}", su.to_dec_str(), gu.to_dec_str(), esc.to_dec_str(), cv, bills.join(" "))
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
