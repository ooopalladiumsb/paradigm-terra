//! Gate #2 — Rust ns/op benchmark harness (per docs/notes/gate2-benchmark-plan.md).
//!
//! MEASURE, do not optimize. Median ns/op per gas-priced operation class + ratio to the
//! DSL-binary-op peg, checked against [0.5x, 2.0x] of each class's abstract weight. Out-of-band
//! cells are FLAGGED as Tier-2 candidates — nothing is tuned here.
//!
//!   cargo run --release --bin gas_bench        # from cal-gas-rs/
//!
//! Measures the per-op EVALUATION traversal cost: `evaluate(&ast, &bindings, scope)` with the AST
//! parsed ONCE outside the timed loop, so fixed parse cost cannot swamp the marginal per-op cost
//! and compress every ratio toward 1. MCP / state-rent classes time their cal-gas primitives
//! directly. `black_box` defeats LLVM dead-code elimination. ns/op is machine-relative; the RATIO
//! to the peg is the portable signal. Mirrors the TS harness `cal-gas/bench/gas-bench.mjs`.

use std::hint::black_box;
use std::time::Instant;

use paradigm_terra_cal_gas::{effects_bytes, mcp_call_units};
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};
use paradigm_terra_dsl::{evaluate, parse_expression, Bindings, Expr, Scope, Version};

fn jcs(s: &str) -> JcsValue {
    parse_canonical(s).expect("canonical parse")
}

/// Parse an expression once; return (ast, self-check outcome code).
fn parse(src: &str, scope: Scope) -> Expr {
    parse_expression(&jcs(src), scope, Version::V12).expect("parse expression")
}

/// median ns/op: warmup, then 99 batches of `inner` reps; ns/op = batch_ns/inner; median of batches.
fn bench<F: FnMut()>(mut f: F, warmup: usize, batches: usize, inner: usize) -> f64 {
    for _ in 0..warmup {
        f();
    }
    let mut samples: Vec<f64> = Vec::with_capacity(batches);
    for _ in 0..batches {
        let t0 = Instant::now();
        for _ in 0..inner {
            f();
        }
        let dt = t0.elapsed().as_nanos() as f64;
        samples.push(dt / inner as f64);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[samples.len() / 2]
}

struct Row {
    cls: &'static str,
    ns: f64,
    weight: f64,
    synthetic: bool,
    note: &'static str,
}

fn main() {
    let v12_scope = Scope::Precondition;

    // bindings
    let state_bind = Bindings {
        state: Some(jcs(r#"{"a":{"b":{"c":{"d":{"e":1}}}},"arr":[1,2,3],"m":{"k":1},"x":1}"#)),
        ..Default::default()
    };
    let inv_bind = Bindings {
        before: Some(jcs(r#"{"x":1}"#)),
        after: Some(jcs(r#"{"x":1}"#)),
        ..Default::default()
    };
    let empty = Bindings::default();

    // pre-parsed ASTs (single op, minimal operands)
    let peg_ast = parse(r#"{"lhs":{"const":1},"op":"eq","rhs":{"const":1}}"#, v12_scope);
    let ck_ast = parse(r#"{"lhs":{"var":"state.m"},"op":"contains_key","rhs":{"const":"k"}}"#, v12_scope);
    let size_ast = parse(r#"{"lhs":{"arg":{"var":"state.arr"},"op":"size"},"op":"gte","rhs":{"const":0}}"#, v12_scope);
    let gate_ast = parse(r#"{"args":[{"const":"treasury.transfer"}],"op":"is_owner_required"}"#, Scope::Gate);
    let inv_ast = parse(r#"{"lhs":{"var":"state.after.x"},"op":"gte","rhs":{"const":0}}"#, Scope::Invariant);
    let shallow_ast = parse(r#"{"lhs":{"var":"state.x"},"op":"eq","rhs":{"const":1}}"#, v12_scope); // 2 segs
    let deep_ast = parse(r#"{"lhs":{"var":"state.a.b.c.d.e"},"op":"eq","rhs":{"const":1}}"#, v12_scope); // 6 segs

    // self-check: every parsed expression must evaluate cleanly.
    let checks = [
        ("peg", evaluate(&peg_ast, &empty, v12_scope)),
        ("contains_key", evaluate(&ck_ast, &state_bind, v12_scope)),
        ("size", evaluate(&size_ast, &state_bind, v12_scope)),
        ("gate", evaluate(&gate_ast, &state_bind, Scope::Gate)),
        ("invariant", evaluate(&inv_ast, &inv_bind, Scope::Invariant)),
        ("shallow", evaluate(&shallow_ast, &state_bind, v12_scope)),
        ("deep", evaluate(&deep_ast, &state_bind, v12_scope)),
    ];
    for (name, oc) in &checks {
        if oc.code != "EVALUATION_TRUE" && oc.code != "EVALUATION_FALSE" {
            eprintln!("SELF-CHECK FAILED: {name}: {} {:?}", oc.code, oc.reason);
            std::process::exit(1);
        }
    }

    // 1 KiB-ish committed effects value for the state-rent encode class.
    let kib_src = format!(r#"[{{"ns":"ptra","op":"set","path":"state.ptra.balances.x","value":"0x{}"}}]"#, "ab".repeat(496));
    let kib = jcs(&kib_src);

    let (w, b, i) = (2000usize, 99usize, 1000usize);
    let peg = bench(|| { black_box(evaluate(black_box(&peg_ast), black_box(&empty), v12_scope)); }, w, b, i);
    let ns_shallow = bench(|| { black_box(evaluate(black_box(&shallow_ast), black_box(&state_bind), v12_scope)); }, w, b, i);
    let ns_deep = bench(|| { black_box(evaluate(black_box(&deep_ast), black_box(&state_bind), v12_scope)); }, w, b, i);
    let ns_per_segment = (ns_deep - ns_shallow) / 4.0; // 6 - 2 = 4 extra segments

    let ns_gate = bench(|| { black_box(evaluate(black_box(&gate_ast), black_box(&state_bind), Scope::Gate)); }, w, b, i);
    let ns_ck = bench(|| { black_box(evaluate(black_box(&ck_ast), black_box(&state_bind), v12_scope)); }, w, b, i);
    let ns_size = bench(|| { black_box(evaluate(black_box(&size_ast), black_box(&state_bind), v12_scope)); }, w, b, i);
    let ns_inv = bench(|| { black_box(evaluate(black_box(&inv_ast), black_box(&inv_bind), Scope::Invariant)); }, w, b, i);
    let ns_mcp_r = bench(|| { black_box(mcp_call_units(black_box("agent.get_balance"))); }, w, b, i);
    let ns_mcp_w = bench(|| { black_box(mcp_call_units(black_box("agent.transfer"))); }, w, b, i);
    let bytes = effects_bytes(&kib).expect("effects_bytes").to_dec_str().parse::<f64>().unwrap();
    let ns_encode = bench(|| { black_box(effects_bytes(black_box(&kib)).unwrap()); }, w, b, 200);
    let ns_byte = ns_encode / bytes;

    let rows = vec![
        Row { cls: "binary op (peg)", ns: peg, weight: 1.0, synthetic: false, note: "eq(const,const)" },
        Row { cls: "path segment", ns: ns_per_segment, weight: 2.0, synthetic: false, note: "slope: var(6seg)-var(2seg) /4" },
        Row { cls: "gate op", ns: ns_gate, weight: 5.0, synthetic: false, note: "is_owner_required(const) @gate" },
        Row { cls: "contains_key", ns: ns_ck, weight: 10.0, synthetic: false, note: "contains_key(var,const)" },
        Row { cls: "size", ns: ns_size, weight: 20.0, synthetic: false, note: "gte(size(var),0)" },
        Row { cls: "invariant base", ns: ns_inv, weight: 5.0, synthetic: false, note: "gte(var(after.x),0) @invariant" },
        Row { cls: "mcp read (synthetic)", ns: ns_mcp_r, weight: 50.0, synthetic: true, note: "mcp_call_units" },
        Row { cls: "mcp write (synthetic)", ns: ns_mcp_w, weight: 200.0, synthetic: true, note: "mcp_call_units" },
        Row { cls: "state-rent / byte", ns: ns_byte, weight: 1.0, synthetic: false, note: "effects_bytes / bytes" },
    ];

    println!("\nGate #2 — Rust ns/op baseline (peg = binary op = {:.0} ns/op, {} effect bytes)\n", peg, bytes as u64);
    println!("| class | ns/op | ratio | weight | band | status | op |");
    println!("|---|--:|--:|--:|---|---|---|");
    for r in &rows {
        let ratio = r.ns / peg;
        let (lo, hi) = (0.5 * r.weight, 2.0 * r.weight);
        let (band, mark) = if r.cls == "binary op (peg)" {
            ("—".to_string(), "peg".to_string())
        } else if r.synthetic {
            (format!("[{lo}, {hi}]"), "SYNTH".to_string())
        } else {
            (format!("[{lo}, {hi}]"), if ratio >= lo && ratio <= hi { "IN" } else { "OUT" }.to_string())
        };
        let ns = if r.ns.abs() >= 100.0 { format!("{:.0}", r.ns) } else { format!("{:.2}", r.ns) };
        println!("| {} | {} | {:.2} | {} | {} | {} | {} |", r.cls, ns, ratio, r.weight, band, mark, r.note);
    }
    let outs: Vec<&str> = rows.iter().filter(|r| {
        let ratio = r.ns / peg;
        !r.synthetic && r.cls != "binary op (peg)" && (ratio < 0.5 * r.weight || ratio > 2.0 * r.weight)
    }).map(|r| r.cls).collect();
    if outs.is_empty() {
        println!("\n✅ all measurable cells IN band");
    } else {
        println!("\n⚠ OUT-of-band (Tier-2 candidates, NOT to fix here): {}", outs.join(", "));
    }
    println!("(synthetic rows: MCP — validator-side CPU is verb classification only; real MCP cost is off-chain.)");
}
