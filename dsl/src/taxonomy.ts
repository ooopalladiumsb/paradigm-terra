/**
 * Registered action taxonomy and capability lookup tables.
 *
 * `ACTION_TAXONOMY` is the closed `namespace.verb` enum from CAL Execution
 * Spec v0.1.0-draft §2.3. `OWNER_REQUIRED_ACTIONS` is the enum from §8.2. Both
 * are constitutional constants amendable only by Tier 2; this module is the
 * single source of truth the DSL gate operators (DSL v1.2 §5.2) consult.
 *
 * `REQUIRES_SCOPE_TABLE` mirrors CAL Annex A (DRAFT populated 2026-05-28). It
 * covers every action in `ACTION_TAXONOMY`; an action absent from the table
 * (or mapped to []) carries no scope gate at §4.3 and relies on §4 signature
 * + structural checks alone. Scope strings are the flattened Constitution §V
 * `asset_scope` / `treasury_access_level` / `governance_scope` vocabulary.
 * Tier implication (treasury_access:transfer ⇒ :view, governance_scope:vote
 * ⇒ :propose) is applied by `capabilityGrants`, not stored on the agent.
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
 * CAL Annex A (DRAFT, 2026-05-28) — action → required scope set. Actions
 * absent from the table carry no scope gate at §4.3. See cal-execution-spec
 * v0.1.0-draft §14 Annex A for the table in narrative form and Constitution §V
 * for the scope vocabulary.
 */
export const REQUIRES_SCOPE_TABLE: Readonly<Record<string, readonly string[]>> = {
  // Asset operations (Constitution §V.5.1 asset_scope)
  "wallet.send_ton": ["ton_transfer"],
  "wallet.send_jetton": ["jetton_access"],
  "wallet.send_nft": ["nft_access"],
  // Treasury (Constitution §V.5.1 treasury_access_level)
  "treasury.transfer": ["treasury_access:transfer"],
  "treasury.distribute_rewards": ["treasury_access:transfer"],
  "treasury.buyback_burn": ["treasury_access:transfer"],
  // Governance (Constitution §V.5.1 governance_scope)
  "governance.propose_amendment": ["governance_scope:propose"],
  "governance.vote": ["governance_scope:vote"],
  "governance.finalize_amendment": ["governance_scope:vote"],
  "governance.vote_as_agent": ["ptra_governance_vote"],
  // PTRA staking (Constitution §V.5.1 asset_scope.ptra_stake)
  "ptra.stake": ["ptra_stake"],
  "ptra.unstake": ["ptra_stake"],
  "ptra.claim_rewards": ["ptra_stake"],
};

/** Tier implication (Annex A): `:transfer` ⇒ `:view`, `:vote` ⇒ `:propose`. */
const IMPLIED_SCOPES: Readonly<Record<string, readonly string[]>> = {
  "treasury_access:transfer": ["treasury_access:view"],
  "governance_scope:vote": ["governance_scope:propose"],
};

/** Expand a granted-scope set by Annex A tier implication. */
export function expandGrantedScopes(granted: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const g of granted) {
    set.add(g);
    const implied = IMPLIED_SCOPES[g];
    if (implied) for (const s of implied) set.add(s);
  }
  return set;
}

export function requiresScope(action: string, scope: string): boolean {
  const scopes = REQUIRES_SCOPE_TABLE[action];
  return scopes !== undefined && scopes.includes(scope);
}
