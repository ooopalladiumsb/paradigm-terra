// Package canonical is the Go parity implementation of the Paradigm Terra
// Canonical Encoding Specification v1.3 (SCF) with the v0.10.0-draft domain-tag
// extensions (STATE_ROOT_V1, DSL_V1.2). It mirrors the TypeScript reference
// (../canonical) and the Rust crate (../canonical-rs) byte-for-byte; the test
// in parity_test.go verifies this against the committed golden vectors.
package canonical

// ErrorClass distinguishes the two error families from the TypeScript reference.
type ErrorClass int

const (
	// NoncanonicalEvent is the hard-validation error from CE v1.3 §9.
	NoncanonicalEvent ErrorClass = iota
	// CanonicalEncoding covers range / shape errors from the encoders.
	CanonicalEncoding
)

// CanonicalError carries a stable string code (identical to the TS/Rust codes)
// and a human-readable message. Error() renders "[CODE] message".
type CanonicalError struct {
	Class   ErrorClass
	Code    string
	Message string
}

func (e *CanonicalError) Error() string {
	return "[" + e.Code + "] " + e.Message
}

func noncanonical(code, message string) *CanonicalError {
	return &CanonicalError{Class: NoncanonicalEvent, Code: code, Message: message}
}

func encodingErr(code, message string) *CanonicalError {
	return &CanonicalError{Class: CanonicalEncoding, Code: code, Message: message}
}
