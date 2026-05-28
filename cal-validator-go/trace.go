// Package calvalidator is the Go parity implementation of the Paradigm Terra CAL
// validator (CAL Execution Spec v0.1.0-draft §3–§9): a pure Validate(cal,
// calHash, snapshot, trace) that drives a SIGNED CAL through the lifecycle and
// emits the reducer-ready stage events, reusing the DSL evaluator + taxonomy
// (dsl-go) and gas pricing/settlement (cal-gas-go). It evaluates, it does not
// execute: external MCP step effects arrive as an execution trace (§4.1). It
// mirrors the TypeScript reference (@paradigm-terra/cal-validator) byte-for-byte;
// parity_test.go loads ../validator/vectors/golden.json and reproduces every
// event sequence, economic field, and bill.
package calvalidator

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

// StepResult is one step's observed outcome: success flag + the deltas it produced.
type StepResult struct {
	OK          bool
	Effects     []canonical.Value
	ErrorDetail string
}

// ExecutionTrace is the deterministic record of an external execution (§4.1).
type ExecutionTrace struct {
	CurrentTick     *big.Int
	Steps           []StepResult
	StateBefore     canonical.Value
	StateAfter      canonical.Value
	OwnerSigPresent bool
	// PinnedMCPSchemaHash is the validator-local pinned MCP schema hash (§4.4).
	// Compared to state.registry.mcp_schema_hash; mismatch fails the CAL with
	// SCHEMA_MISMATCH (no-charge, ingress-class). Empty string = no pin.
	PinnedMCPSchemaHash string
}
