package calreducer

import canonical "github.com/paradigm-terra/canonical-go"

// FoldError reports the ApplyError code and the index at which folding stopped.
type FoldError struct {
	Code  string
	Index int
}

// Materialize folds an ordered event sequence into State from start.
func Materialize(events []canonical.Value, start canonical.Value) (canonical.Value, *FoldError) {
	state := start
	for i, ev := range events {
		s, e := Apply(state, ev)
		if e != nil {
			return nil, &FoldError{Code: e.Code, Index: i}
		}
		state = s
	}
	return state, nil
}

// ScanStateRoots returns the STATE_ROOT after each event, stopping at the first error.
func ScanStateRoots(events []canonical.Value, start canonical.Value) ([][32]byte, *FoldError) {
	roots := make([][32]byte, 0, len(events))
	state := start
	for i, ev := range events {
		s, e := Apply(state, ev)
		if e != nil {
			return roots, &FoldError{Code: e.Code, Index: i}
		}
		state = s
		r, err := StateRootOf(state)
		if err != nil {
			return roots, &FoldError{Code: "STATE_ROOT", Index: i}
		}
		roots = append(roots, r)
	}
	return roots, nil
}
