//! CAL canonical hashing (mirrors `hash.ts`, §2.2/§5/§8.3).

use paradigm_terra_canonical::domains::{CAL_V1, EVENT_V1, RECEIPT_V1};
use paradigm_terra_canonical::hash::domain_hash;
use paradigm_terra_canonical::jcs::{canonicalize_value, JcsValue};
use paradigm_terra_canonical::Result as CanonResult;

/// The canonical, signature-free byte string a CAL hashes and is signed over.
pub fn canonical_unsigned_bytes(cal: &JcsValue) -> CanonResult<Vec<u8>> {
    let value = match cal {
        JcsValue::Object(pairs) => {
            let filtered: Vec<(String, JcsValue)> =
                pairs.iter().filter(|(k, _)| k != "signatures").cloned().collect();
            JcsValue::Object(filtered)
        }
        other => other.clone(),
    };
    canonicalize_value(&value)
}

pub fn cal_hash(cal: &JcsValue) -> CanonResult<[u8; 32]> {
    domain_hash(CAL_V1, &canonical_unsigned_bytes(cal)?)
}

pub fn event_hash(event: &JcsValue) -> CanonResult<[u8; 32]> {
    domain_hash(EVENT_V1, &canonicalize_value(event)?)
}

pub fn receipt_hash(event: &JcsValue) -> CanonResult<[u8; 32]> {
    domain_hash(RECEIPT_V1, &canonicalize_value(event)?)
}
