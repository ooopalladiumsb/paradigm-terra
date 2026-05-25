// Package calreducer is the Go parity implementation of the Paradigm Terra CAL
// event reducer (CAL Spec §7.1): apply(State, Event) -> State as a pure total
// fold with per-CAL effect staging. It mirrors the TypeScript reference
// (@paradigm-terra/cal-reducer) byte-for-byte; parity_test.go verifies against
// ../cal-reducer/vectors/golden.json. STATE_ROOT / JCS come from canonical-go;
// uint256 arithmetic uses the standard library math/big.
package calreducer

// ApplyError is a typed reducer fault (codes pinned by the golden vectors).
type ApplyError struct{ Code string }

func aerr(code string) *ApplyError { return &ApplyError{Code: code} }
