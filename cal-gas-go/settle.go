package calgas

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Per-outcome refund / retention bill (CAL Spec §9.4). Given a terminal outcome
// and the observed bytes written, compute the nano-PTRA amounts a validator
// bakes into the events. Pure; conservation against the reducer's fee
// arithmetic is a validator-phase concern (the reducer is frozen).

// Outcome is a terminal CAL outcome class.
type Outcome string

const (
	Finalized     Outcome = "FINALIZED"
	FailedPrecond Outcome = "FAILED_PRECOND" // PRECOND_FALSE / CAPABILITY_DENIED — spam charge, no gas
	FailedExec    Outcome = "FAILED_EXEC"    // STEP_ERROR / POSTCOND_FALSE / INVARIANT_FALSE / OUT_OF_GAS
	ExpiredPre    Outcome = "EXPIRED_PRE"    // expired before VALIDATED — no PTRA touched
	ExpiredPost   Outcome = "EXPIRED_POST"   // expired after VALIDATED — flat fee retained
)

// GasBill is the §9.4 settlement of a terminal CAL outcome.
type GasBill struct {
	FeeRetained        *big.Int
	DynamicGasConsumed *big.Int
	GasRefunded        *big.Int
	TotalAgentCharge   *big.Int
}

// clampSub returns a-b if a>b, else 0 (mirrors TS clampSub).
func clampSub(a, b *big.Int) *big.Int {
	if a.Cmp(b) > 0 {
		return new(big.Int).Sub(a, b)
	}
	return big.NewInt(0)
}

// Settle computes the gas bill for a terminal CAL outcome (§9.4).
func Settle(outcome Outcome, cal, state canonical.Value, bytesWritten *big.Int) (*GasBill, *GasError) {
	fee := FlatValidationFee(state)
	maxGas := MaxExpectedDynamicGas(cal, fee)

	switch outcome {
	case ExpiredPre:
		return &GasBill{
			FeeRetained:        big.NewInt(0),
			DynamicGasConsumed: big.NewInt(0),
			GasRefunded:        big.NewInt(0),
			TotalAgentCharge:   big.NewInt(0),
		}, nil
	case FailedPrecond, ExpiredPost:
		return &GasBill{
			FeeRetained:        new(big.Int).Set(fee),
			DynamicGasConsumed: big.NewInt(0),
			GasRefunded:        new(big.Int).Set(maxGas),
			TotalAgentCharge:   new(big.Int).Set(fee),
		}, nil
	case Finalized, FailedExec:
		// consumed gas, capped at the escrowed budget (overrun ⇒ OUT_OF_GAS path)
		gu, e := GasUnits(cal, bytesWritten)
		if e != nil {
			return nil, e
		}
		raw := ToNano(gu, GasPrice(state))
		consumed := raw
		if raw.Cmp(maxGas) > 0 {
			consumed = new(big.Int).Set(maxGas)
		}
		return &GasBill{
			FeeRetained:        new(big.Int).Set(fee),
			DynamicGasConsumed: new(big.Int).Set(consumed),
			GasRefunded:        clampSub(maxGas, consumed),
			TotalAgentCharge:   new(big.Int).Add(fee, consumed),
		}, nil
	default:
		return nil, gerr("VALIDATION_ERROR", "UNKNOWN_OUTCOME")
	}
}
