//! Protocol State model + genesis + STATE_ROOT + immutable path helpers
//! (mirrors `state.ts`, §7.3). State is a canonical-rs `JcsValue` object keyed by
//! the eight short namespace names; the §7.3 leaf uses `state.<name>`.

use paradigm_terra_canonical::jcs::{canonicalize_value, JcsValue};
use paradigm_terra_canonical::merkle::{state_root, StateNamespace};
use paradigm_terra_canonical::Result as CanonResult;

pub const NAMESPACES: &[&str] = &[
    "cal", "failure_mode", "governance", "oracles", "ptra", "registry", "tick", "treasury",
];

fn empty_obj() -> JcsValue {
    JcsValue::object(vec![])
}

/// The fixed genesis state (its STATE_ROOT is pinned by the golden vectors).
pub fn genesis() -> JcsValue {
    JcsValue::object(vec![
        ("cal", JcsValue::object(vec![("in_flight", empty_obj()), ("nonces", empty_obj())])),
        (
            "failure_mode",
            JcsValue::object(vec![("is_bounded_mode", JcsValue::Bool(false)), ("capture_guard_counters", empty_obj())]),
        ),
        (
            "governance",
            JcsValue::object(vec![
                ("gas_price_nano_ptra_per_unit", JcsValue::int_u128(1000)),
                ("genesis_validator_set", JcsValue::array(vec![])),
                ("params", empty_obj()),
            ]),
        ),
        ("oracles", JcsValue::object(vec![("feeds", empty_obj())])),
        ("ptra", JcsValue::object(vec![("balances", empty_obj())])),
        (
            "registry",
            JcsValue::object(vec![("agents", empty_obj()), ("mcp_schema_hash", JcsValue::string(&format!("0x{}", "00".repeat(32))))]),
        ),
        ("tick", JcsValue::object(vec![("current", JcsValue::int_u128(0))])),
        (
            "treasury",
            JcsValue::object(vec![
                ("nav", JcsValue::int_u128(0)),
                ("developer_fund_balance", JcsValue::int_u128(0)),
                ("collected_fees_window", JcsValue::int_u128(0)),
            ]),
        ),
    ])
}

/// STATE_ROOT over the eight namespaces (CAL Spec §7.3).
pub fn state_root_of(state: &JcsValue) -> CanonResult<[u8; 32]> {
    let mut nss = Vec::with_capacity(NAMESPACES.len());
    for n in NAMESPACES {
        let content = get_in(state, &[n]).cloned().unwrap_or(JcsValue::Null);
        nss.push(StateNamespace { name: format!("state.{n}"), canonical_bytes: canonicalize_value(&content)? });
    }
    state_root(&nss)
}

/// Read the value at a path; `None` if any segment is missing.
pub fn get_in<'a>(v: &'a JcsValue, path: &[&str]) -> Option<&'a JcsValue> {
    let mut cur = v;
    for seg in path {
        match cur {
            JcsValue::Object(pairs) => match pairs.iter().find(|(k, _)| k == seg) {
                Some((_, c)) => cur = c,
                None => return None,
            },
            _ => return None,
        }
    }
    Some(cur)
}

/// Immutably set a value at a path (cloning along the path).
pub fn set_in(v: &JcsValue, path: &[&str], newval: JcsValue) -> JcsValue {
    if path.is_empty() {
        return newval;
    }
    let head = path[0];
    let mut pairs: Vec<(String, JcsValue)> = match v {
        JcsValue::Object(p) => p.clone(),
        _ => Vec::new(),
    };
    let child = pairs.iter().find(|(k, _)| k == head).map(|(_, c)| c.clone()).unwrap_or(JcsValue::Null);
    let updated = set_in(&child, &path[1..], newval);
    if let Some(slot) = pairs.iter_mut().find(|(k, _)| k == head) {
        slot.1 = updated;
    } else {
        pairs.push((head.to_string(), updated));
    }
    JcsValue::Object(pairs)
}

/// Immutably delete the key at a path (no-op if absent).
pub fn delete_in(v: &JcsValue, path: &[&str]) -> JcsValue {
    match v {
        JcsValue::Object(p) => {
            if path.len() == 1 {
                JcsValue::Object(p.iter().filter(|(k, _)| k != path[0]).cloned().collect())
            } else {
                let head = path[0];
                let mut pairs = p.clone();
                if let Some(slot) = pairs.iter_mut().find(|(k, _)| k == head) {
                    slot.1 = delete_in(&slot.1.clone(), &path[1..]);
                }
                JcsValue::Object(pairs)
            }
        }
        other => other.clone(),
    }
}
