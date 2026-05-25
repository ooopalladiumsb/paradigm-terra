//! JCS read helpers for the gas layer (mirrors `util.ts`).

use paradigm_terra_canonical::jcs::JcsValue;

use crate::u256::U256;

/// Read a value at a path of object keys; `None` if any segment is missing or a
/// non-object is encountered (`JcsValue::get` returns `None` off-object).
pub fn get_in<'a>(obj: &'a JcsValue, path: &[&str]) -> Option<&'a JcsValue> {
    let mut cur = obj;
    for seg in path {
        cur = cur.get(seg)?;
    }
    Some(cur)
}

/// Read an integer field as uint256, defaulting when absent/non-integer
/// (mirrors `asBig`: a canonical integer parses, anything else falls back).
pub fn as_big(v: Option<&JcsValue>, def: U256) -> U256 {
    match v {
        Some(JcsValue::Int(s)) => U256::from_dec_str(s).unwrap_or(def),
        _ => def,
    }
}
