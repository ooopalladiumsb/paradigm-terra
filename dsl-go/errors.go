// Package dsl is the Go parity implementation of Paradigm Terra DSL v1.2
// (Constraint DSL v1.1 + CAL v0.1.0-draft extensions). It mirrors the
// TypeScript reference (@paradigm-terra/dsl) byte-for-byte; parity_test.go
// loads ../dsl/vectors/golden.json and reproduces every outcome + reason
// sub-code and every DSL_HASH. JCS parsing, hashing, NFC and address handling
// are reused from the canonical-go module.
package dsl

// Phase is the normative outcome bucket of a fault (Constraint DSL v1.1 §5).
type Phase int

const (
	PhaseParse Phase = iota
	PhaseValidation
	PhaseRuntime
)

// Code returns the normative outcome string for the phase.
func (p Phase) Code() string {
	switch p {
	case PhaseParse:
		return "PARSE_ERROR"
	case PhaseValidation:
		return "VALIDATION_ERROR"
	default:
		return "ERROR"
	}
}

// DslError is a fault carrying its phase and a stable reason sub-code. The
// reason strings are byte-identical to the TypeScript reference.
type DslError struct {
	Phase  Phase
	Reason string
}

func (e *DslError) Error() string { return "[" + e.Phase.Code() + "/" + e.Reason + "]" }

func perr(reason string) *DslError { return &DslError{Phase: PhaseParse, Reason: reason} }
func verr(reason string) *DslError { return &DslError{Phase: PhaseValidation, Reason: reason} }
func rerr(reason string) *DslError { return &DslError{Phase: PhaseRuntime, Reason: reason} }
