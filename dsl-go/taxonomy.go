package dsl

// Registered action taxonomy + capability tables (mirrors taxonomy.ts).
// REGISTERED_ACTIONS is CAL §2.3; ownerRequired is §8.2; requiresScopeTable
// mirrors CAL Annex A (DRAFT populated 2026-05-28; Constitution §V vocabulary).

var registeredActions = map[string]bool{
	"wallet.send_ton": true, "wallet.send_jetton": true, "wallet.send_nft": true,
	"agent.register": true, "agent.migrate": true, "agent.freeze": true, "agent.unfreeze": true,
	"capability.update": true, "capability.temporal_boost_request": true, "capability.temporal_boost_release": true,
	"treasury.transfer": true, "treasury.distribute_rewards": true, "treasury.buyback_burn": true,
	"governance.propose_amendment": true, "governance.vote": true, "governance.vote_as_agent": true, "governance.finalize_amendment": true,
	"oracles.submit_feed": true, "oracles.slash": true, "oracles.force_update": true,
	"ptra.stake": true, "ptra.unstake": true, "ptra.claim_rewards": true,
	"failure_mode.emergency_withdraw": true, "failure_mode.enter_bounded": true, "failure_mode.exit_bounded": true,
	"cal.cancel": true,
}

func isRegisteredAction(a string) bool { return registeredActions[a] }

// IsRegisteredAction reports whether a is a registered `namespace.verb` action
// (CAL §2.3). Exported for downstream consumers such as the CAL layer.
func IsRegisteredAction(a string) bool { return isRegisteredAction(a) }

var ownerRequiredActions = map[string]bool{
	"capability.update":               true,
	"agent.migrate":                   true,
	"treasury.transfer":               true,
	"governance.vote_as_agent":        true,
	"governance.propose_amendment":    true,
	"ptra.stake":                      true,
	"ptra.unstake":                    true,
	"failure_mode.emergency_withdraw": true,
}

func isOwnerRequired(a string) bool { return ownerRequiredActions[a] }

// IsOwnerRequired reports whether action requires a valid owner_sig (CAL §8.2).
func IsOwnerRequired(a string) bool { return isOwnerRequired(a) }

// boundedModeWhitelist is the CAL §10.2 set of actions admissible while
// state.failure_mode.is_bounded_mode == true. Tier 1 amendable.
var boundedModeWhitelist = map[string]bool{
	"failure_mode.emergency_withdraw": true,
	"failure_mode.exit_bounded":       true,
	"oracles.force_update":            true,
	"oracles.submit_feed":             true,
	"agent.freeze":                    true,
	"cal.cancel":                      true,
}

// IsBoundedAllowed reports whether action is admissible in Bounded Mode (CAL §10.2).
func IsBoundedAllowed(a string) bool { return boundedModeWhitelist[a] }

// RequiredScopes returns the scopes an action requires (CAL Annex A DRAFT,
// 2026-05-28). Empty slice ⇒ no scope gate at §4.3. The returned slice MUST
// NOT be mutated.
func RequiredScopes(action string) []string { return requiresScopeTable[action] }

var requiresScopeTable = map[string][]string{
	// Asset operations (Constitution §V.5.1 asset_scope)
	"wallet.send_ton":    {"ton_transfer"},
	"wallet.send_jetton": {"jetton_access"},
	"wallet.send_nft":    {"nft_access"},
	// Treasury (Constitution §V.5.1 treasury_access_level)
	"treasury.transfer":           {"treasury_access:transfer"},
	"treasury.distribute_rewards": {"treasury_access:transfer"},
	"treasury.buyback_burn":       {"treasury_access:transfer"},
	// Governance (Constitution §V.5.1 governance_scope)
	"governance.propose_amendment": {"governance_scope:propose"},
	"governance.vote":              {"governance_scope:vote"},
	"governance.finalize_amendment": {"governance_scope:vote"},
	"governance.vote_as_agent":     {"ptra_governance_vote"},
	// PTRA staking (Constitution §V.5.1 asset_scope.ptra_stake)
	"ptra.stake":         {"ptra_stake"},
	"ptra.unstake":       {"ptra_stake"},
	"ptra.claim_rewards": {"ptra_stake"},
}

func requiresScope(action, scope string) bool {
	for _, s := range requiresScopeTable[action] {
		if s == scope {
			return true
		}
	}
	return false
}

// ImpliedScopes returns the scopes implied by granted under Annex A tier
// implication (`:transfer` ⇒ `:view`, `:vote` ⇒ `:propose`). Empty slice ⇒ none.
// The returned slice MUST NOT be mutated.
func ImpliedScopes(granted string) []string {
	switch granted {
	case "treasury_access:transfer":
		return []string{"treasury_access:view"}
	case "governance_scope:vote":
		return []string{"governance_scope:propose"}
	}
	return nil
}
