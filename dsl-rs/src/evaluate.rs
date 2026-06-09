//! Total evaluator for DSL v1.2 (mirrors `evaluate.ts`).

use paradigm_terra_canonical::jcs::JcsValue;

use crate::ast::{ArithOp, CmpOp, Expr, Scope, Version};
use crate::errors::{DResult, DslError, Phase};
use crate::i256::I256;
use crate::parse::parse_expression;
use crate::taxonomy::{is_owner_required, requires_scope};
use crate::values::{const_value, key_form, materialize, values_equal, Value};

#[derive(Default, Clone)]
pub struct Bindings {
    pub state: Option<JcsValue>,
    pub before: Option<JcsValue>,
    pub after: Option<JcsValue>,
    pub params: Option<JcsValue>,
    pub capability: Option<JcsValue>,
    pub signatures: Option<JcsValue>,
}

impl Bindings {
    /// Build bindings from a JcsValue object whose keys are the binding roots.
    pub fn from_jcs(j: &JcsValue) -> Bindings {
        let mut b = Bindings::default();
        if let JcsValue::Object(pairs) = j {
            for (k, v) in pairs {
                match k.as_str() {
                    "state" => b.state = Some(v.clone()),
                    "before" => b.before = Some(v.clone()),
                    "after" => b.after = Some(v.clone()),
                    "params" => b.params = Some(v.clone()),
                    "capability" => b.capability = Some(v.clone()),
                    "signatures" => b.signatures = Some(v.clone()),
                    _ => {}
                }
            }
        }
        b
    }
}

#[derive(Debug, Clone)]
pub struct Outcome {
    pub code: String,
    pub reason: Option<String>,
}

fn require_int(v: &Value) -> DResult<I256> {
    match v {
        Value::Int(i) => Ok(i.clone()),
        Value::Null => Err(DslError::runtime("NULL_MISUSE")),
        _ => Err(DslError::validation("TYPE_MISMATCH")),
    }
}

fn require_bool(v: &Value) -> DResult<bool> {
    match v {
        Value::Bool(b) => Ok(*b),
        Value::Null => Err(DslError::runtime("NULL_MISUSE")),
        _ => Err(DslError::validation("TYPE_MISMATCH")),
    }
}

fn require_string(v: &Value) -> DResult<String> {
    match v {
        Value::Str(s) => Ok(s.clone()),
        Value::Null => Err(DslError::runtime("NULL_MISUSE")),
        _ => Err(DslError::validation("TYPE_MISMATCH")),
    }
}

fn checked(v: Option<I256>) -> DResult<Value> {
    v.map(Value::Int).ok_or_else(|| DslError::runtime("OVERFLOW"))
}

fn resolve_path(raw: &str, path: &[String], b: &Bindings, scope: Scope) -> DResult<Value> {
    let root = path[0].as_str();
    let (base, rest): (&Option<JcsValue>, &[String]) = match root {
        "params" => (&b.params, &path[1..]),
        "capability" => (&b.capability, &path[1..]),
        "signatures" => (&b.signatures, &path[1..]),
        "state" => {
            if path.get(1).map(|s| s.as_str()) == Some("before") {
                (&b.before, &path[2..])
            } else if path.get(1).map(|s| s.as_str()) == Some("after") {
                (&b.after, &path[2..])
            } else if scope == Scope::PostCondition || scope == Scope::Invariant {
                (&b.before, &path[1..])
            } else {
                (&b.state, &path[1..])
            }
        }
        _ => return Err(DslError::runtime("MISSING_VAR")),
    };

    let Some(base) = base else {
        return Err(DslError::runtime("MISSING_VAR"));
    };
    let _ = raw;

    let mut cur = base;
    for seg in rest {
        match cur {
            JcsValue::Object(pairs) => match pairs.iter().find(|(k, _)| k == seg) {
                Some((_, v)) => cur = v,
                None => return Err(DslError::runtime("MISSING_VAR")),
            },
            _ => return Err(DslError::runtime("MISSING_VAR")),
        }
    }
    materialize(cur)
}

fn eval_node(expr: &Expr, b: &Bindings, scope: Scope) -> DResult<Value> {
    match expr {
        Expr::Const(c) => const_value(c),
        Expr::Var { raw, path } => resolve_path(raw, path, b, scope),
        Expr::Action(a) => Ok(Value::Str(a.clone())),
        Expr::Eq { neg, lhs, rhs } => {
            let eq = values_equal(&eval_node(lhs, b, scope)?, &eval_node(rhs, b, scope)?)?;
            Ok(Value::Bool(if *neg { !eq } else { eq }))
        }
        Expr::Cmp { op, lhs, rhs } => {
            let l = require_int(&eval_node(lhs, b, scope)?)?;
            let r = require_int(&eval_node(rhs, b, scope)?)?;
            let res = match op {
                CmpOp::Lt => l < r,
                CmpOp::Lte => l <= r,
                CmpOp::Gt => l > r,
                CmpOp::Gte => l >= r,
            };
            Ok(Value::Bool(res))
        }
        Expr::Arith { op, lhs, rhs } => {
            let l = require_int(&eval_node(lhs, b, scope)?)?;
            let r = require_int(&eval_node(rhs, b, scope)?)?;
            match op {
                ArithOp::Add => checked(l.add(&r)),
                ArithOp::Sub => checked(l.sub(&r)),
                ArithOp::Mul => checked(l.mul(&r)),
                ArithOp::Div => {
                    if r.is_zero() {
                        return Err(DslError::runtime("DIV_BY_ZERO"));
                    }
                    checked(l.div(&r)) // None == MIN / -1 overflow
                }
                ArithOp::Mod => {
                    if r.is_zero() {
                        return Err(DslError::runtime("MOD_BY_ZERO"));
                    }
                    Ok(Value::Int(l.euclid_mod(&r)))
                }
            }
        }
        Expr::Bool { is_and, args } => eval_boolean(*is_and, args, b, scope),
        Expr::Not(arg) => Ok(Value::Bool(!require_bool(&eval_node(arg, b, scope)?)?)),
        Expr::ContainsKey { map, key } => {
            let m = eval_node(map, b, scope)?;
            let entries = match &m {
                Value::Null => return Err(DslError::runtime("NULL_MISUSE")),
                Value::Map(e) => e,
                _ => return Err(DslError::validation("TYPE_MISMATCH")),
            };
            let k = key_form(&eval_node(key, b, scope)?)?;
            Ok(Value::Bool(entries.iter().any(|(ek, _)| ek == &k)))
        }
        Expr::Size(arg) => {
            let v = eval_node(arg, b, scope)?;
            match v {
                Value::List(items) => Ok(Value::Int(I256::from_u64(items.len() as u64))),
                Value::Map(entries) => Ok(Value::Int(I256::from_u64(entries.len() as u64))),
                Value::Null => Ok(Value::Int(I256::from_u64(0))),
                _ => Err(DslError::validation("TYPE_MISMATCH")),
            }
        }
        Expr::RequiresScope { action, scope: sc } => {
            let a = require_string(&eval_node(action, b, scope)?)?;
            let s = require_string(&eval_node(sc, b, scope)?)?;
            Ok(Value::Bool(requires_scope(&a, &s)))
        }
        Expr::IsOwnerRequired { action } => {
            let a = require_string(&eval_node(action, b, scope)?)?;
            Ok(Value::Bool(is_owner_required(&a)))
        }
    }
}

fn eval_boolean(is_and: bool, args: &[Expr], b: &Bindings, scope: Scope) -> DResult<Value> {
    let results: Vec<DResult<Value>> = args.iter().map(|a| eval_node(a, b, scope)).collect();
    // ERROR dominates VALIDATION_ERROR (no short-circuit, DSL v1.1 §3.1).
    for r in &results {
        if let Err(e) = r {
            if e.phase == Phase::Runtime {
                return Err(e.clone());
            }
        }
    }
    for r in &results {
        if let Err(e) = r {
            if e.phase == Phase::Validation {
                return Err(e.clone());
            }
        }
    }
    let mut acc = is_and;
    for r in &results {
        let v = r.as_ref().map_err(|e| e.clone())?;
        let bv = require_bool(v)?;
        acc = if is_and { acc && bv } else { acc || bv };
    }
    Ok(Value::Bool(acc))
}

/// Evaluate an already-parsed expression against bindings. Never panics.
/// Public so a pre-parsed AST can be evaluated in a tight loop (e.g. the §C.3
/// ns/op benchmark harness isolates evaluation from parse cost); mirrors the
/// TypeScript reference's exported `evaluate`.
pub fn evaluate(expr: &Expr, b: &Bindings, scope: Scope) -> Outcome {
    match eval_node(expr, b, scope) {
        Ok(Value::Bool(true)) => Outcome { code: "EVALUATION_TRUE".into(), reason: None },
        Ok(Value::Bool(false)) => Outcome { code: "EVALUATION_FALSE".into(), reason: None },
        Ok(_) => Outcome { code: "VALIDATION_ERROR".into(), reason: Some("NON_BOOLEAN_RESULT".into()) },
        Err(e) => Outcome { code: e.phase.code().into(), reason: Some(e.reason.into()) },
    }
}

/// Parse + evaluate, returning the unified normative outcome.
pub fn run(j: &JcsValue, scope: Scope, version: Version, b: &Bindings) -> Outcome {
    match parse_expression(j, scope, version) {
        Ok(expr) => evaluate(&expr, b, scope),
        Err(e) => Outcome { code: e.phase.code().into(), reason: Some(e.reason.into()) },
    }
}
