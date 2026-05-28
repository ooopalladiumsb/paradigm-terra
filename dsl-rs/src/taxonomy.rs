//! Registered action taxonomy + capability tables (mirrors `taxonomy.ts`).
//!
//! `REGISTERED_ACTIONS` is the CAL §2.3 enum; `OWNER_REQUIRED_ACTIONS` is §8.2.
//! `required_scopes` mirrors CAL Annex A (DRAFT populated 2026-05-28); see the
//! TS reference for the narrative + Constitution §V for the scope vocabulary.

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

/// CAL §10.2 — actions admissible while `state.failure_mode.is_bounded_mode == true`. Tier 1 amendable.
pub const BOUNDED_MODE_WHITELIST: &[&str] = &[
    "failure_mode.emergency_withdraw",
    "failure_mode.exit_bounded",
    "oracles.force_update",
    "oracles.submit_feed",
    "agent.freeze",
    "cal.cancel",
];

pub fn is_bounded_allowed(action: &str) -> bool {
    BOUNDED_MODE_WHITELIST.contains(&action)
}

/// CAL Annex A (DRAFT, 2026-05-28) — action → required scope set. Actions
/// returning `&[]` carry no scope gate at §4.3. Mirrors `taxonomy.ts`.
pub fn required_scopes(action: &str) -> &'static [&'static str] {
    match action {
        // Asset operations (Constitution §V.5.1 asset_scope)
        "wallet.send_ton" => &["ton_transfer"],
        "wallet.send_jetton" => &["jetton_access"],
        "wallet.send_nft" => &["nft_access"],
        // Treasury (Constitution §V.5.1 treasury_access_level)
        "treasury.transfer" => &["treasury_access:transfer"],
        "treasury.distribute_rewards" => &["treasury_access:transfer"],
        "treasury.buyback_burn" => &["treasury_access:transfer"],
        // Governance (Constitution §V.5.1 governance_scope)
        "governance.propose_amendment" => &["governance_scope:propose"],
        "governance.vote" => &["governance_scope:vote"],
        "governance.finalize_amendment" => &["governance_scope:vote"],
        "governance.vote_as_agent" => &["ptra_governance_vote"],
        // PTRA staking (Constitution §V.5.1 asset_scope.ptra_stake)
        "ptra.stake" => &["ptra_stake"],
        "ptra.unstake" => &["ptra_stake"],
        "ptra.claim_rewards" => &["ptra_stake"],
        _ => &[],
    }
}

pub fn requires_scope(action: &str, scope: &str) -> bool {
    required_scopes(action).contains(&scope)
}

/// Tier implication (Annex A): `:transfer` ⇒ `:view`, `:vote` ⇒ `:propose`.
/// Returns the scopes implied by `granted` (excluding `granted` itself).
pub fn implied_scopes(granted: &str) -> &'static [&'static str] {
    match granted {
        "treasury_access:transfer" => &["treasury_access:view"],
        "governance_scope:vote" => &["governance_scope:propose"],
        _ => &[],
    }
}
