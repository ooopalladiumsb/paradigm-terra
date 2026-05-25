//! Byte-for-byte parity against the TypeScript reference golden vectors
//! (`../cal-reducer/vectors/golden.json`, from `@paradigm-terra/cal-reducer`):
//! the genesis STATE_ROOT, per-event STATE_ROOTs, and ApplyError codes.

use paradigm_terra_cal_reducer::{apply, genesis, scan_state_roots, state_root_of};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};

const GOLDEN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../cal-reducer/vectors/golden.json"));

fn hex32(b: &[u8; 32]) -> String {
    let mut s = String::with_capacity(66);
    s.push_str("0x");
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn arr(doc: &JcsValue, key: &str) -> Vec<JcsValue> {
    doc.get(key).and_then(|v| v.as_array()).expect(key).to_vec()
}

#[test]
fn parity_with_typescript_golden_vectors() {
    let doc = parse_canonical(GOLDEN).expect("parse golden.json");
    let mut fails: Vec<String> = Vec::new();
    let mut checks = 0usize;

    // genesis root
    checks += 1;
    let g = hex32(&state_root_of(&genesis()).unwrap());
    let want_g = doc.get("genesis_state_root").and_then(|x| x.as_str()).unwrap();
    if g != want_g {
        fails.push(format!("genesis_state_root: got {g} want {want_g}"));
    }

    // sequences
    for s in arr(&doc, "sequences") {
        let id = s.get("id").and_then(|x| x.as_str()).unwrap_or("<no id>");
        let start = parse_canonical(s.get("start_state_canonical").and_then(|x| x.as_str()).unwrap()).unwrap();
        let events: Vec<JcsValue> = s
            .get("events")
            .and_then(|x| x.as_array())
            .unwrap()
            .iter()
            .map(|e| parse_canonical(e.as_str().unwrap()).unwrap())
            .collect();
        let (roots, error) = scan_state_roots(&events, start);
        checks += 1;
        if let Some((code, idx)) = error {
            fails.push(format!("{id}: unexpected ApplyError {code} at {idx}"));
            continue;
        }
        let want: Vec<&str> = s.get("expected_roots").and_then(|x| x.as_array()).unwrap().iter().map(|r| r.as_str().unwrap()).collect();
        let got: Vec<String> = roots.iter().map(hex32).collect();
        if got != want {
            fails.push(format!("{id}: roots mismatch\n got={got:?}\nwant={want:?}"));
        }
    }

    // errors
    for e in arr(&doc, "errors") {
        let id = e.get("id").and_then(|x| x.as_str()).unwrap_or("<no id>");
        let start = parse_canonical(e.get("start_state_canonical").and_then(|x| x.as_str()).unwrap()).unwrap();
        let event = parse_canonical(e.get("event_canonical").and_then(|x| x.as_str()).unwrap()).unwrap();
        let want = e.get("expected_error_code").and_then(|x| x.as_str()).unwrap();
        checks += 1;
        match apply(&start, &event) {
            Ok(_) => fails.push(format!("{id}: expected ApplyError {want}, got Ok")),
            Err(err) if err.code != want => fails.push(format!("{id}: got {} want {want}", err.code)),
            Err(_) => {}
        }
    }

    if !fails.is_empty() {
        panic!("{} parity failures:\n{}", fails.len(), fails.join("\n"));
    }
    println!("All {checks} parity checks passed against TypeScript golden vectors.");
}
