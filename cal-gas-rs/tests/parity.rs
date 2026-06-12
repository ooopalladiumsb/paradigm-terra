//! Byte-for-byte parity against the TypeScript reference golden vectors
//! (`../cal-gas/vectors/golden.json`, from `@paradigm-terra/cal-gas`): every
//! gas unit (static + total), gas price, flat fee, max-expected gas, escrow, the
//! §9.3 admission gate, and the full §9.4 GasBill for each of the five outcomes.

use paradigm_terra_cal_gas::{
    can_validate, escrow_requirement, flat_validation_fee, gas_price, gas_units,
    max_expected_dynamic_gas, settle, static_gas_units, Outcome, U256,
};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};

const GOLDEN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../cal-gas/vectors/golden.json"));

const OUTCOMES: [&str; 6] = ["FINALIZED", "FAILED_PRECOND", "FAILED_NO_CHARGE", "FAILED_EXEC", "EXPIRED_PRE", "EXPIRED_POST"];

fn s<'a>(v: &'a JcsValue, key: &str) -> &'a str {
    v.get(key).and_then(JcsValue::as_str).unwrap_or_else(|| panic!("missing string field {key}"))
}

#[test]
fn parity_with_typescript_golden_vectors() {
    let doc = parse_canonical(GOLDEN).expect("parse golden.json");
    let vectors = doc.get("vectors").and_then(JcsValue::as_array).expect("vectors array");
    assert!(vectors.len() >= 5, "expected at least 5 gas vectors");

    let mut fails: Vec<String> = Vec::new();
    let mut checks = 0usize;

    for v in vectors {
        let id = s(v, "id");
        let cal = parse_canonical(s(v, "cal_canonical")).expect("parse cal_canonical");
        let state = parse_canonical(s(v, "state_canonical")).expect("parse state_canonical");
        let bytes = U256::from_dec_str(s(v, "bytes_written")).expect("bytes_written");
        let fee = flat_validation_fee(&state);
        let out = v.get("output").expect("output");

        let scalar: Vec<(&str, String, &str)> = vec![
            ("static_gas_units", static_gas_units(&cal).unwrap().to_dec_str(), s(out, "static_gas_units")),
            ("gas_units", gas_units(&cal, &bytes, &U256::ZERO).unwrap().to_dec_str(), s(out, "gas_units")),
            ("gas_price", gas_price(&state).to_dec_str(), s(out, "gas_price")),
            ("flat_fee", fee.to_dec_str(), s(out, "flat_fee")),
            ("max_expected_gas", max_expected_dynamic_gas(&cal, fee).to_dec_str(), s(out, "max_expected_gas")),
            ("escrow", escrow_requirement(&cal, &state).to_dec_str(), s(out, "escrow")),
        ];
        for (name, got, want) in scalar {
            checks += 1;
            if got != want {
                fails.push(format!("{id}/{name}: got {got} want {want}"));
            }
        }

        checks += 1;
        let want_cv = matches!(out.get("can_validate"), Some(JcsValue::Bool(true)));
        let got_cv = can_validate(&cal, &state);
        if got_cv != want_cv {
            fails.push(format!("{id}/can_validate: got {got_cv} want {want_cv}"));
        }

        let bills = out.get("bills").expect("bills");
        for name in OUTCOMES {
            let oc = Outcome::from_str(name).unwrap();
            let b = settle(oc, &cal, &state, &bytes, &U256::ZERO).unwrap();
            let w = bills.get(name).expect("bill for outcome");
            for (field, got, want) in [
                ("feeRetained", b.fee_retained.to_dec_str(), s(w, "feeRetained")),
                ("dynamicGasConsumed", b.dynamic_gas_consumed.to_dec_str(), s(w, "dynamicGasConsumed")),
                ("gasRefunded", b.gas_refunded.to_dec_str(), s(w, "gasRefunded")),
                ("totalAgentCharge", b.total_agent_charge.to_dec_str(), s(w, "totalAgentCharge")),
            ] {
                checks += 1;
                if got != want {
                    fails.push(format!("{id}/{name}/{field}: got {got} want {want}"));
                }
            }
        }
    }

    if !fails.is_empty() {
        panic!("{} parity failures:\n{}", fails.len(), fails.join("\n"));
    }
    println!("All {checks} gas parity checks passed against TypeScript golden vectors.");
}
