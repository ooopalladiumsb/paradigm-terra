/**
 * Registered action taxonomy and capability lookup tables.
 *
 * `ACTION_TAXONOMY` is the closed `namespace.verb` enum from CAL Execution
 * Spec v0.1.0-draft §2.3. `OWNER_REQUIRED_ACTIONS` is the enum from §8.2. Both
 * are constitutional constants amendable only by Tier 2; this module is the
 * single source of truth the DSL gate operators (DSL v1.2 §5.2) consult.
 *
 * DRAFT NOTE — `REQUIRES_SCOPE_TABLE` below is provisional. The authoritative
 * action → required-scope matrix is CAL Annex A, which is not yet populated
 * (CAL §14). The entries here are derived from the §2.3 namespaces and the
 * Constitution §V scope flags so that `requires_scope` is fully exercisable;
 * they MUST be reconciled against Annex A at Conformance Freeze.
 */

/** CAL §2.3 — namespace → registered verbs. */
export const ACTION_TAXONOMY: Readonly<Record<string, readonly string[]>> = {
  wallet: ["send_ton", "send_jetton", "send_nft"],
  agent: ["register", "migrate", "freeze", "unfreeze"],
  capability: ["update", "temporal_boost_request", "temporal_boost_release"],
  treasury: ["transfer", "distribute_rewards", "buyback_burn"],
  governance: ["propose_amendment", "vote", "vote_as_agent", "finalize_amendment"],
  oracles: ["submit_feed", "slash", "force_update"],
  ptra: ["stake", "unstake", "claim_rewards"],
  failure_mode: ["emergency_withdraw", "enter_bounded", "exit_bounded"],
  cal: ["cancel"],
};

/** Flattened set of every valid `namespace.verb` action. */
export const REGISTERED_ACTIONS: ReadonlySet<string> = new Set(
  Object.entries(ACTION_TAXONOMY).flatMap(([ns, verbs]) => verbs.map((v) => `${ns}.${v}`)),
);

export function isRegisteredAction(action: string): boolean {
  return REGISTERED_ACTIONS.has(action);
}

/** CAL §8.2 — actions that require a valid `owner_sig` co-signature. */
export const OWNER_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  "capability.update",
  "agent.migrate",
  "treasury.transfer",
  "governance.vote_as_agent",
  "governance.propose_amendment",
  "ptra.stake",
  "ptra.unstake",
  "failure_mode.emergency_withdraw",
]);

export function isOwnerRequired(action: string): boolean {
  return OWNER_REQUIRED_ACTIONS.has(action);
}

/** CAL §10.2 — actions admissible while `state.failure_mode.is_bounded_mode == true`. Tier 1 amendable. */
export const BOUNDED_MODE_WHITELIST: ReadonlySet<string> = new Set([
  "failure_mode.emergency_withdraw",
  "failure_mode.exit_bounded",
  "oracles.force_update",
  "oracles.submit_feed",
  "agent.freeze",
  "cal.cancel",
]);

export function isBoundedAllowed(action: string): boolean {
  return BOUNDED_MODE_WHITELIST.has(action);
}

/**
 * DRAFT provisional action → required asset/treasury scopes (CAL Annex A pending).
 * Used only by the gate-only `requires_scope` operator.
 */
export const REQUIRES_SCOPE_TABLE: Readonly<Record<string, readonly string[]>> = {
  "wallet.send_ton": ["ton_transfer"],
  "wallet.send_jetton": ["jetton_access"],
  "wallet.send_nft": ["nft_access"],
  "treasury.transfer": ["treasury_access:transfer"],
  "treasury.distribute_rewards": ["treasury_access:distribute"],
  "treasury.buyback_burn": ["treasury_access:transfer"],
  "ptra.stake": ["ptra_stake"],
  "ptra.unstake": ["ptra_stake"],
  "governance.vote_as_agent": ["ptra_governance_vote"],
};

export function requiresScope(action: string, scope: string): boolean {
  const scopes = REQUIRES_SCOPE_TABLE[action];
  return scopes !== undefined && scopes.includes(scope);
}
