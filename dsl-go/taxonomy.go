package dsl

// Registered action taxonomy + capability tables (mirrors taxonomy.ts).
// REGISTERED_ACTIONS is CAL §2.3; ownerRequired is §8.2; requiresScope is
// provisional pending CAL Annex A.

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

// RequiredScopes returns the scopes an action requires (CAL Annex A pending;
// mirrors REQUIRES_SCOPE_TABLE in taxonomy.ts). The gas/validator layers
// consult it. The returned slice MUST NOT be mutated.
func RequiredScopes(action string) []string { return requiresScopeTable[action] }

var requiresScopeTable = map[string][]string{
	"wallet.send_ton":             {"ton_transfer"},
	"wallet.send_jetton":          {"jetton_access"},
	"wallet.send_nft":             {"nft_access"},
	"treasury.transfer":           {"treasury_access:transfer"},
	"treasury.distribute_rewards": {"treasury_access:distribute"},
	"treasury.buyback_burn":       {"treasury_access:transfer"},
	"ptra.stake":                  {"ptra_stake"},
	"ptra.unstake":                {"ptra_stake"},
	"governance.vote_as_agent":    {"ptra_governance_vote"},
}

func requiresScope(action, scope string) bool {
	for _, s := range requiresScopeTable[action] {
		if s == scope {
			return true
		}
	}
	return false
}
