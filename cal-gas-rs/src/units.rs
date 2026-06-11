//! Gas-unit model (CAL Spec §9.2). The DSL portion is delegated to
//! `paradigm_terra_dsl::expression_cost`, so it is byte-for-byte the same numbers
//! the DSL layer already pins (binary=1, contains_key=10, size=20,
//! path-segment=2, gate=5). MCP and rent costs layer on top. All units uint256.

use paradigm_terra_canonical::jcs::{canonicalize_value, JcsValue};
use paradigm_terra_dsl::{expression_cost, DslError, Scope, Version};

use crate::errors::GasResult;
use crate::u256::U256;
use crate::util::get_in;

pub const MCP_READ: u64 = 50; // get_*  MCP call
pub const MCP_WRITE: u64 = 200; // any other (mutating) MCP call
pub const INVARIANT_BASE: u64 = 5; // per invariant expression, plus its DSL cost
pub const STATE_RENT_PER_BYTE: u64 = 1;
// PFC2-M4 (Multisig v2.1, §9.2): owner-authorization verification weight, linear in the number of
// owner signatures actually verified (NOT the owner-set size). The operator signature is unpriced
// (one raw verify, exactly as v1) — multisig prices only the owner model it introduces.
pub const OWNER_AUTH_BASE: u64 = 50; // fixed setup for the owner-authorization check (k >= 1)
pub const ED25519_VERIFY_WEIGHT: u64 = 100; // per verified owner signature (one Ed25519 verify)

/// PFC2-M4 §9.2: owner-authorization gas, linear in `k` = owner signatures verified. `0` when the
/// action is not owner-gated, so the operator-only path keeps its exact v1 cost. A v1 single-owner
/// action and its migrated 1-of-1 form both have k = 1 ⇒ identical price (SC-4). Mirrors `ownerAuthUnits`.
pub fn owner_auth_units(k: u64) -> U256 {
    if k == 0 {
        U256::ZERO
    } else {
        U256::from_u64(OWNER_AUTH_BASE + k * ED25519_VERIFY_WEIGHT)
    }
}

/// Cost of one embedded DSL expression. A bare AST is read as v1.2; a
/// `{dsl_version, expr}` envelope overrides the version (mirrors `dslCost` +
/// `parseEnvelope` in the TS reference).
fn dsl_cost(node: Option<&JcsValue>, scope: Scope) -> GasResult<U256> {
    let mut version = Version::V12;
    let mut expr = node;
    if let Some(obj) = node {
        if obj.get("dsl_version").is_some() {
            version = match obj.get("dsl_version").and_then(JcsValue::as_str) {
                Some("1.1") => Version::V11,
                Some("1.2") => Version::V12,
                _ => return Err(DslError::validation("UNSUPPORTED_VERSION").into()),
            };
            expr = match obj.get("expr") {
                Some(e) => Some(e),
                None => return Err(DslError::parse("MALFORMED_ENVELOPE").into()),
            };
        }
    }
    match expr {
        Some(j) => Ok(U256::from_u64(expression_cost(j, scope, version)?)),
        None => Err(DslError::parse("MALFORMED_NODE").into()),
    }
}

/// MCP-call units for a step verb: `get_*` is a read (50), everything else a write (200).
pub fn mcp_call_units(verb: &str) -> U256 {
    let part = verb.split('.').nth(1).unwrap_or("");
    U256::from_u64(if part.starts_with("get_") { MCP_READ } else { MCP_WRITE })
}

/// Byte length of the committed effects' canonical serialization (state rent input).
pub fn effects_bytes(effects: &JcsValue) -> GasResult<U256> {
    Ok(U256::from_u64(canonicalize_value(effects)?.len() as u64))
}

/// Data-independent gas units of a CAL (everything except state rent):
/// preconditions DSL cost + per-step (1 MCP call + post-condition DSL cost)
/// + per-invariant (base 5 + DSL cost).
pub fn static_gas_units(cal: &JcsValue) -> GasResult<U256> {
    let mut u = dsl_cost(get_in(cal, &["preconditions"]), Scope::Precondition)?;

    if let Some(JcsValue::Array(steps)) = get_in(cal, &["steps"]) {
        for step in steps {
            if let Some(verb) = get_in(step, &["verb"]).and_then(JcsValue::as_str) {
                u = u + mcp_call_units(verb);
            }
            if let Some(JcsValue::Array(pcs)) = get_in(step, &["post_conditions"]) {
                for pc in pcs {
                    u = u + dsl_cost(Some(pc), Scope::PostCondition)?;
                }
            }
        }
    }

    if let Some(JcsValue::Array(invs)) = get_in(cal, &["invariants"]) {
        for inv in invs {
            u = u + U256::from_u64(INVARIANT_BASE) + dsl_cost(Some(inv), Scope::Invariant)?;
        }
    }
    Ok(u)
}

/// Total gas units = static units + state rent (1 per byte written) + owner-authorization weight.
/// `owner_auth` (PFC2-M4, from `owner_auth_units(k)`) is 0 for every non-owner-gated CAL, so those
/// stay byte-for-byte the v1 cost. Mirrors `gasUnits(cal, bytes, ownerAuth=0)`.
pub fn gas_units(cal: &JcsValue, bytes_written: &U256, owner_auth: &U256) -> GasResult<U256> {
    Ok(static_gas_units(cal)? + *bytes_written * U256::from_u64(STATE_RENT_PER_BYTE) + *owner_auth)
}
