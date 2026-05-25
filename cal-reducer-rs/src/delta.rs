//! The `Delta` effect language (mirrors `delta.ts`, §4). Checked uint256 arithmetic.

use paradigm_terra_canonical::jcs::JcsValue;

use crate::errors::ApplyError;
use crate::state::{delete_in, get_in, set_in};
use crate::u256::U256;

fn as_u256(v: &JcsValue) -> Option<U256> {
    match v {
        JcsValue::Int(s) => U256::from_dec_str(s),
        _ => None,
    }
}

fn bad() -> ApplyError {
    ApplyError::new("BAD_DELTA")
}

/// Validate + apply one Delta (a JcsValue `{ns, op, path, value?}`).
pub fn apply_delta_json(state: &JcsValue, d: &JcsValue) -> Result<JcsValue, ApplyError> {
    let ns = d.get("ns").and_then(|x| x.as_str()).ok_or_else(bad)?;
    let op = d.get("op").and_then(|x| x.as_str()).ok_or_else(bad)?;
    let path_arr = d.get("path").and_then(|x| x.as_array()).ok_or_else(bad)?;
    let mut full: Vec<&str> = vec![ns];
    for p in path_arr {
        full.push(p.as_str().ok_or_else(bad)?);
    }

    match op {
        "set" => Ok(set_in(state, &full, d.get("value").cloned().unwrap_or(JcsValue::Null))),
        "delete" => Ok(delete_in(state, &full)),
        "add" | "sub" => {
            let cur = match get_in(state, &full) {
                Some(c) => as_u256(c).ok_or_else(bad)?,
                None => U256::ZERO,
            };
            let val = as_u256(d.get("value").ok_or_else(bad)?).ok_or_else(bad)?;
            let res = if op == "add" {
                cur.checked_add(&val).ok_or_else(|| ApplyError::new("OVERFLOW"))?
            } else {
                cur.checked_sub(&val).ok_or_else(|| ApplyError::new("UNDERFLOW"))?
            };
            Ok(set_in(state, &full, JcsValue::Int(res.to_dec_str())))
        }
        _ => Err(bad()),
    }
}
