//! PFC2-M3 — multisig (AuthorizationSet v2) registry: the v1→v2 migration and the well-formed
//! owner-record invariant. Mirrors `migrate.ts` (§1.1/§4). The bound is enforced where Deltas
//! commit an owner record (see `delta.rs`); this module is the single source of the invariant and
//! the deterministic upgrade (state-only, no external input ⇒ reproducible for the M5 vectors).

use paradigm_terra_canonical::jcs::JcsValue;

use crate::state::{delete_in, get_in, set_in};

/// §1.1 upper bound on the owner set.
pub const MAX_OWNERS: usize = 16;

/// §1.1: a well-formed v2 owner record — `owners` non-empty, DISTINCT, ascending (by raw pubkey
/// bytes; equal-length hex strings, so string order == byte order), at most MAX_OWNERS; and
/// `1 <= threshold <= owners.len()`. Mirrors `ownerRecordWellFormed`.
pub fn owner_record_well_formed(owners: Option<&JcsValue>, threshold: Option<&JcsValue>) -> bool {
    let owners = match owners.and_then(JcsValue::as_array) {
        Some(a) => a,
        None => return false,
    };
    let t: u64 = match threshold {
        Some(JcsValue::Int(s)) => match s.parse() {
            Ok(n) => n,
            Err(_) => return false,
        },
        _ => return false,
    };
    let n = owners.len();
    if n < 1 || n > MAX_OWNERS {
        return false;
    }
    if t < 1 || t > n as u64 {
        return false;
    }
    for i in 0..n {
        let o = match owners[i].as_str() {
            Some(s) if !s.is_empty() => s,
            _ => return false,
        };
        if i > 0 {
            let prev = owners[i - 1].as_str().unwrap_or("");
            if o == prev || o < prev {
                return false; // distinct + ascending
            }
        }
    }
    true
}

/// §4: the deterministic v1→v2 registry upgrade — a pure function of the state alone (no external
/// input), idempotent. `owner_pubkey:"K"` → `owners:["K"], threshold:1` (1-of-1 bridge, SC-4);
/// `owner_pubkey:""` → `owners:[], threshold:0` (no-owner record). Mirrors `migrateRegistryV1ToV2`.
pub fn migrate_registry_v1_to_v2(state: &JcsValue) -> JcsValue {
    let ids: Vec<String> = match get_in(state, &["registry", "agents"]) {
        Some(JcsValue::Object(a)) => {
            let mut v: Vec<String> = a.iter().map(|(k, _)| k.clone()).collect();
            v.sort();
            v
        }
        _ => return state.clone(),
    };
    let mut s = state.clone();
    for id in ids {
        let (is_v2, has_owner_pubkey, pk) = {
            let rec = match get_in(&s, &["registry", "agents", &id]) {
                Some(r) => r,
                None => continue,
            };
            let is_v2 = rec.get("owners").and_then(JcsValue::as_array).is_some();
            let has_op = rec.get("owner_pubkey").is_some();
            let pk = rec.get("owner_pubkey").and_then(JcsValue::as_str).unwrap_or("").to_string();
            (is_v2, has_op, pk)
        };
        if is_v2 || !has_owner_pubkey {
            continue;
        }
        let (owners, threshold) = if pk.is_empty() {
            (Vec::new(), "0")
        } else {
            (vec![JcsValue::Str(pk)], "1")
        };
        s = set_in(&s, &["registry", "agents", &id, "owners"], JcsValue::Array(owners));
        s = set_in(&s, &["registry", "agents", &id, "threshold"], JcsValue::Int(threshold.to_string()));
        s = delete_in(&s, &["registry", "agents", &id, "owner_pubkey"]);
    }
    s
}
