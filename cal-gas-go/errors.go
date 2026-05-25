// Package calgas is the Go parity implementation of the Paradigm Terra CAL gas
// layer (CAL Execution Spec v0.1.0-draft §9): the gas-unit model (reusing the
// DSL cost model), nano-PTRA pricing, the upfront escrow gate (§9.3), and the
// per-outcome refund/retention bill (§9.4). It mirrors the TypeScript reference
// (@paradigm-terra/cal-gas) byte-for-byte; parity_test.go loads
// ../cal-gas/vectors/golden.json and reproduces every gas unit, amount, and
// bill. The DSL cost model is reused from dsl-go; JCS from canonical-go;
// uint256 arithmetic uses math/big.
package calgas

import dsl "github.com/paradigm-terra/dsl-go"

// GasError is a fault from the gas layer: a DSL cost-model rejection or an
// envelope validation error. The phase/reason mirror the thrown DslError /
// CanonicalError of the TS reference.
type GasError struct {
	Phase  string // PARSE_ERROR | VALIDATION_ERROR
	Reason string
}

func (e *GasError) Error() string { return "[" + e.Phase + "/" + e.Reason + "]" }

func gerr(phase, reason string) *GasError { return &GasError{Phase: phase, Reason: reason} }

// fromDsl wraps a DSL fault as a GasError, preserving its phase + reason code.
func fromDsl(e *dsl.DslError) *GasError {
	if e == nil {
		return nil
	}
	return &GasError{Phase: e.Phase.Code(), Reason: e.Reason}
}
