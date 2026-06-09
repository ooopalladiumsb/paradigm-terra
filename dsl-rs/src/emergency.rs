//! Constitutionally injected Bounded-Mode invariants (DSL v1.2 §7.1, CAL §10.3).
//!
//! When `state.failure_mode.is_bounded_mode == true` at VALIDATED time, the
//! runtime injects this exact set on top of whatever invariants the CAL declares.
//! The set is deterministically derived by every validator from the flag alone,
//! so it is NOT part of the CAL hash but IS part of consensus (DSL v1.2 §7.2).
//!
//! Mirrors `dsl/src/emergency.ts` byte-for-byte under canonical JCS.

use paradigm_terra_canonical::jcs::JcsValue;

fn var(path: &str) -> JcsValue {
    JcsValue::object(vec![("var", JcsValue::Str(path.to_string()))])
}

fn const_int(n: i64) -> JcsValue {
    JcsValue::object(vec![("const", JcsValue::Int(n.to_string()))])
}

fn const_bool(b: bool) -> JcsValue {
    JcsValue::object(vec![("const", JcsValue::Bool(b))])
}

fn op_binary(op: &str, lhs: JcsValue, rhs: JcsValue) -> JcsValue {
    JcsValue::object(vec![
        ("op", JcsValue::Str(op.to_string())),
        ("lhs", lhs),
        ("rhs", rhs),
    ])
}

/// The three injected emergency invariants, in canonical declaration order.
pub fn emergency_invariants() -> Vec<JcsValue> {
    vec![
        op_binary(
            "gte",
            var("state.after.treasury.developer_fund_balance"),
            var("state.before.treasury.developer_fund_balance"),
        ),
        op_binary(
            "gte",
            var("state.after.treasury.nav"),
            op_binary("sub", var("state.before.treasury.nav"), const_int(0)),
        ),
        op_binary(
            "eq",
            var("state.after.failure_mode.is_bounded_mode"),
            const_bool(true),
        ),
    ]
}

/// Return the effective invariant set for a CAL: declared + emergency set when bounded.
pub fn effective_invariants(declared: &[JcsValue], is_bounded_mode: bool) -> Vec<JcsValue> {
    let mut out: Vec<JcsValue> = declared.to_vec();
    if is_bounded_mode {
        out.extend(emergency_invariants());
    }
    out
}
