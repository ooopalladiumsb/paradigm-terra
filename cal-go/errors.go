// Package cal is the Go parity implementation of the Paradigm Terra CAL skeleton
// (CAL Execution Spec v0.1.0-draft): the immutable, hashable foundation —
// wire-format validation, CAL_HASH + signing payload, event/receipt hashing,
// lifecycle. It mirrors the TypeScript reference (@paradigm-terra/cal)
// byte-for-byte; parity_test.go verifies against ../cal/vectors/golden.json.
// JCS/hash/address come from canonical-go; embedded-DSL parse-validation +
// taxonomy from dsl-go. The reducer (§7.1) and gas (§9) phases are absent.
package cal

type calErr struct {
	code   string
	detail string
}

func cerr(code string) *calErr          { return &calErr{code: code} }
func cerrD(code, detail string) *calErr { return &calErr{code: code, detail: detail} }

// CheckResult is the stable validation outcome (empty Code == valid; empty
// Detail == no detail, since no code/detail is legitimately the empty string).
type CheckResult struct {
	Valid  bool
	Code   string
	Detail string
}
