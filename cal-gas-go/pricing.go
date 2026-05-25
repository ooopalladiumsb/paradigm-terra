package calgas

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Pricing & escrow (CAL Spec §9.2–§9.3). All amounts are uint256 nano-PTRA.
const (
	DefaultGasPrice          int64 = 1000   // nano-PTRA per gas unit (= 1 µPTRA), §9.2 genesis
	DefaultFlatValidationFee int64 = 100000 // nano-PTRA, §12.6 placeholder
	GasLimitFeeMultiplier    int64 = 100    // default gas_limit = fee × 100, §9.3
)

func GasPrice(state canonical.Value) *big.Int {
	return readBig(state, []string{"governance", "gas_price_nano_ptra_per_unit"}, big.NewInt(DefaultGasPrice))
}

// ToNano converts gas units to nano-PTRA.
func ToNano(units, price *big.Int) *big.Int {
	return new(big.Int).Mul(units, price)
}

func FlatValidationFee(state canonical.Value) *big.Int {
	return readBig(state, []string{"governance", "params", "flat_validation_fee_nano_ptra"}, big.NewInt(DefaultFlatValidationFee))
}

// MaxExpectedDynamicGas is the upper bound the agent escrows for dynamic gas
// (CAL gas_limit_ptra, else fee × 100).
func MaxExpectedDynamicGas(cal canonical.Value, fee *big.Int) *big.Int {
	def := new(big.Int).Mul(fee, big.NewInt(GasLimitFeeMultiplier))
	return readBig(cal, []string{"gas_limit_ptra"}, def)
}

// EscrowRequirement is the total PTRA escrowed at SIGNED→VALIDATED (§9.3).
func EscrowRequirement(cal, state canonical.Value) *big.Int {
	fee := FlatValidationFee(state)
	return new(big.Int).Add(fee, MaxExpectedDynamicGas(cal, fee))
}

func BalanceOf(state canonical.Value, agent string) *big.Int {
	return readBig(state, []string{"ptra", "balances", agent}, big.NewInt(0))
}

// CanValidate is the §9.3 admission gate: the agent must cover the full escrow.
func CanValidate(cal, state canonical.Value) bool {
	agentV, ok := getIn(cal, []string{"agent_id"})
	if !ok {
		return false
	}
	agent, ok := agentV.(string)
	if !ok {
		return false
	}
	return BalanceOf(state, agent).Cmp(EscrowRequirement(cal, state)) >= 0
}
