//! Runtime value model + DSL type system (mirrors `values.ts`).

use paradigm_terra_canonical::addresses::is_canonical_address;
use paradigm_terra_canonical::jcs::JcsValue;
use paradigm_terra_canonical::strings::{assert_assigned, utf8_nfc_bytes};

use crate::ast::ConstVal;
use crate::errors::{DResult, DslError};
use crate::i256::I256;

#[derive(Debug, Clone)]
pub enum Value {
    Int(I256),
    Bool(bool),
    Str(String),
    Bytes32(String),
    Address(String),
    List(Vec<Value>),
    Map(Vec<(String, Value)>),
    Null,
}

impl Value {
    pub fn kind(&self) -> &'static str {
        match self {
            Value::Int(_) => "int256",
            Value::Bool(_) => "bool",
            Value::Str(_) => "string",
            Value::Bytes32(_) => "bytes32",
            Value::Address(_) => "address",
            Value::List(_) => "list",
            Value::Map(_) => "map",
            Value::Null => "null",
        }
    }
}

fn is_bytes32(s: &str) -> bool {
    s.len() == 66 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn classify_string(s: &str) -> &'static str {
    if is_canonical_address(s) {
        "address"
    } else if is_bytes32(s) {
        "bytes32"
    } else {
        "string"
    }
}

pub fn make_string(s: &str) -> DResult<Value> {
    assert_assigned(s).map_err(|_| DslError::runtime("STRING_UNASSIGNED"))?;
    Ok(Value::Str(s.to_string()))
}

pub fn make_bytes32(s: &str) -> DResult<Value> {
    if !is_bytes32(s) {
        return Err(DslError::validation("BYTES32_MALFORMED"));
    }
    Ok(Value::Bytes32(format!("0x{}", s[2..].to_lowercase())))
}

pub fn make_address(s: &str) -> DResult<Value> {
    if !is_canonical_address(s) {
        return Err(DslError::validation("ADDRESS_NONCANONICAL"));
    }
    Ok(Value::Address(s.to_string()))
}

pub fn const_value(c: &ConstVal) -> DResult<Value> {
    match c {
        ConstVal::Int(i) => Ok(Value::Int(i.clone())),
        ConstVal::Bool(b) => Ok(Value::Bool(*b)),
        ConstVal::Str(s) => make_string(s),
        ConstVal::Bytes32(s) => make_bytes32(s),
        ConstVal::Address(s) => make_address(s),
        ConstVal::Null => Ok(Value::Null),
    }
}

/// Materialize a value read from bound state/params (a JcsValue) into a Value.
pub fn materialize(j: &JcsValue) -> DResult<Value> {
    match j {
        JcsValue::Null => Ok(Value::Null),
        JcsValue::Bool(b) => Ok(Value::Bool(*b)),
        JcsValue::Int(s) => match I256::from_dec_str(s) {
            Some(i) => Ok(Value::Int(i)),
            None => Err(DslError::validation("INT256_RANGE")),
        },
        JcsValue::Str(s) => match classify_string(s) {
            "address" => make_address(s),
            "bytes32" => make_bytes32(s),
            _ => make_string(s),
        },
        JcsValue::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for it in items {
                out.push(materialize(it)?);
            }
            Ok(Value::List(out))
        }
        JcsValue::Object(pairs) => {
            let mut out = Vec::with_capacity(pairs.len());
            for (k, v) in pairs {
                out.push((k.clone(), materialize(v)?));
            }
            Ok(Value::Map(out))
        }
    }
}

pub fn key_form(v: &Value) -> DResult<String> {
    match v {
        Value::Str(s) => Ok(s.clone()),
        Value::Address(a) => Ok(a.clone()),
        Value::Bytes32(h) => Ok(h.clone()),
        _ => Err(DslError::validation("KEY_TYPE")),
    }
}

fn nfc(s: &str) -> DResult<Vec<u8>> {
    utf8_nfc_bytes(s).map_err(|_| DslError::runtime("STRING_UNASSIGNED"))
}

/// Structural equality (DSL v1.1 §3.3). Type mismatch between two non-null
/// operands is a VALIDATION_ERROR; null is comparable with anything.
pub fn values_equal(a: &Value, b: &Value) -> DResult<bool> {
    if matches!(a, Value::Null) || matches!(b, Value::Null) {
        return Ok(matches!(a, Value::Null) && matches!(b, Value::Null));
    }
    if a.kind() != b.kind() {
        return Err(DslError::validation("TYPE_MISMATCH"));
    }
    Ok(match (a, b) {
        (Value::Int(x), Value::Int(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Str(x), Value::Str(y)) => nfc(x)? == nfc(y)?,
        (Value::Bytes32(x), Value::Bytes32(y)) => x == y,
        (Value::Address(x), Value::Address(y)) => x == y,
        (Value::List(x), Value::List(y)) => {
            if x.len() != y.len() {
                false
            } else {
                let mut eq = true;
                for (xi, yi) in x.iter().zip(y.iter()) {
                    if !values_equal(xi, yi)? {
                        eq = false;
                        break;
                    }
                }
                eq
            }
        }
        (Value::Map(x), Value::Map(y)) => {
            if x.len() != y.len() {
                false
            } else {
                let mut eq = true;
                for (k, v) in x {
                    match y.iter().find(|(yk, _)| yk == k) {
                        Some((_, yv)) => {
                            if !values_equal(v, yv)? {
                                eq = false;
                                break;
                            }
                        }
                        None => {
                            eq = false;
                            break;
                        }
                    }
                }
                eq
            }
        }
        _ => unreachable!("kinds already matched"),
    })
}
