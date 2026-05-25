//! Registered action taxonomy + capability tables (mirrors `taxonomy.ts`).
//!
//! `REGISTERED_ACTIONS` is the CAL §2.3 enum; `OWNER_REQUIRED_ACTIONS` is §8.2.
//! `REQUIRES_SCOPE_TABLE` is provisional pending CAL Annex A.

pub const REGISTERED_ACTIONS: &[&str] = &[
    "wallet.send_ton",
    "wallet.send_jetton",
    "wallet.send_nft",
    "agent.register",
    "agent.migrate",
    "agent.freeze",
    "agent.unfreeze",
    "capability.update",
    "capability.temporal_boost_request",
    "capability.temporal_boost_release",
    "treasury.transfer",
    "treasury.distribute_rewards",
    "treasury.buyback_burn",
    "governance.propose_amendment",
    "governance.vote",
    "governance.vote_as_agent",
    "governance.finalize_amendment",
    "oracles.submit_feed",
    "oracles.slash",
    "oracles.force_update",
    "ptra.stake",
    "ptra.unstake",
    "ptra.claim_rewards",
    "failure_mode.emergency_withdraw",
    "failure_mode.enter_bounded",
    "failure_mode.exit_bounded",
    "cal.cancel",
];

pub fn is_registered_action(action: &str) -> bool {
    REGISTERED_ACTIONS.contains(&action)
}

pub const OWNER_REQUIRED_ACTIONS: &[&str] = &[
    "capability.update",
    "agent.migrate",
    "treasury.transfer",
    "governance.vote_as_agent",
    "governance.propose_amendment",
    "ptra.stake",
    "ptra.unstake",
    "failure_mode.emergency_withdraw",
];

pub fn is_owner_required(action: &str) -> bool {
    OWNER_REQUIRED_ACTIONS.contains(&action)
}

/// Provisional action -> required scopes (CAL Annex A pending). Mirrors the
/// `REQUIRES_SCOPE_TABLE` of `taxonomy.ts`; the gas/validator layers consult it.
pub fn required_scopes(action: &str) -> &'static [&'static str] {
    match action {
        "wallet.send_ton" => &["ton_transfer"],
        "wallet.send_jetton" => &["jetton_access"],
        "wallet.send_nft" => &["nft_access"],
        "treasury.transfer" => &["treasury_access:transfer"],
        "treasury.distribute_rewards" => &["treasury_access:distribute"],
        "treasury.buyback_burn" => &["treasury_access:transfer"],
        "ptra.stake" => &["ptra_stake"],
        "ptra.unstake" => &["ptra_stake"],
        "governance.vote_as_agent" => &["ptra_governance_vote"],
        _ => &[],
    }
}

pub fn requires_scope(action: &str, scope: &str) -> bool {
    required_scopes(action).contains(&scope)
}
