//! Byte-for-byte parity against the TypeScript reference golden vectors
//! (`../cal/vectors/golden.json`, from `@paradigm-terra/cal`). Verifies every
//! validation outcome (code + detail), CAL_HASH, canonical unsigned bytes, and
//! event/receipt hash. Parity evidence to promote the vectors to NORMATIVE.

use paradigm_terra_cal::{cal_hash, canonical_unsigned_bytes, check_cal, event_hash, receipt_hash};
use paradigm_terra_canonical::jcs::parse_canonical;

const GOLDEN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../cal/vectors/golden.json"));

fn hex_bytes(b: &[u8]) -> String {
    let mut s = String::with_capacity(2 + b.len() * 2);
    s.push_str("0x");
    for byte in b {
        s.push_str(&format!("{byte:02x}"));
    }
    s
}

#[test]
fn parity_with_typescript_golden_vectors() {
    let doc = parse_canonical(GOLDEN).expect("parse golden.json");
    let mut fails: Vec<String> = Vec::new();
    let mut checks = 0usize;

    let cals = doc.get("cals").and_then(|v| v.as_array()).expect("cals[]");
    assert!(cals.len() >= 11, "expected >=11 CAL vectors, got {}", cals.len());
    for v in cals {
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("<no id>");
        let cal = parse_canonical(v.get("cal_canonical").and_then(|x| x.as_str()).unwrap()).expect("parse cal");
        let res = check_cal(&cal);
        let output = v.get("output").expect("output");

        let want_valid = matches!(output.get("valid"), Some(paradigm_terra_canonical::jcs::JcsValue::Bool(true)));
        let want_code = output.get("code").and_then(|x| x.as_str());
        let want_detail = output.get("detail").and_then(|x| x.as_str());

        checks += 1;
        if res.valid != want_valid {
            fails.push(format!("{id}.valid: got {} want {}", res.valid, want_valid));
        }
        if res.code != want_code {
            fails.push(format!("{id}.code: got {:?} want {:?}", res.code, want_code));
        }
        if res.detail.as_deref() != want_detail {
            fails.push(format!("{id}.detail: got {:?} want {:?}", res.detail, want_detail));
        }

        if want_valid {
            checks += 2;
            let got_hash = hex_bytes(&cal_hash(&cal).unwrap());
            if got_hash != output.get("cal_hash").and_then(|x| x.as_str()).unwrap() {
                fails.push(format!("{id}.cal_hash mismatch"));
            }
            let got_unsigned = hex_bytes(&canonical_unsigned_bytes(&cal).unwrap());
            if got_unsigned != output.get("unsigned_bytes_hex").and_then(|x| x.as_str()).unwrap() {
                fails.push(format!("{id}.unsigned_bytes mismatch"));
            }
        }
    }

    let events = doc.get("events").and_then(|v| v.as_array()).expect("events[]");
    for e in events {
        let id = e.get("id").and_then(|x| x.as_str()).unwrap_or("<no id>");
        let ev = parse_canonical(e.get("event_canonical").and_then(|x| x.as_str()).unwrap()).expect("parse event");
        let output = e.get("output").expect("output");
        checks += 2;
        if hex_bytes(&event_hash(&ev).unwrap()) != output.get("event_hash").and_then(|x| x.as_str()).unwrap() {
            fails.push(format!("{id}.event_hash mismatch"));
        }
        if hex_bytes(&receipt_hash(&ev).unwrap()) != output.get("receipt_hash").and_then(|x| x.as_str()).unwrap() {
            fails.push(format!("{id}.receipt_hash mismatch"));
        }
    }

    if !fails.is_empty() {
        panic!("{} parity failures:\n{}", fails.len(), fails.join("\n"));
    }
    println!("All {checks} parity checks passed against TypeScript golden vectors.");
}
