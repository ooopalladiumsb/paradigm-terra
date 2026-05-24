package dsl

import "math/big"

// Scope is the lexical scope in which an expression appears (DSL v1.2 §4–§6).
type Scope int

const (
	ScopePrecondition Scope = iota
	ScopePostCondition
	ScopeInvariant
	ScopeGate
)

func ScopeFromString(s string) (Scope, bool) {
	switch s {
	case "precondition":
		return ScopePrecondition, true
	case "post_condition":
		return ScopePostCondition, true
	case "invariant":
		return ScopeInvariant, true
	case "gate":
		return ScopeGate, true
	}
	return 0, false
}

// Version selects DSL semantics + hash domain tag.
type Version int

const (
	V11 Version = iota
	V12
)

func VersionFromString(s string) (Version, bool) {
	switch s {
	case "1.1":
		return V11, true
	case "1.2":
		return V12, true
	}
	return 0, false
}

// ConstVal is a typed `{const}` literal.
type ConstVal struct {
	Typ string // int256 | bool | string | bytes32 | address | null
	I   *big.Int
	B   bool
	S   string
}

// Expr is a validated AST node (tagged union via Node).
type Expr struct {
	Node string // const|var|action|eq|cmp|arith|bool|not|contains_key|size|requires_scope|is_owner_required
	CV   ConstVal
	Raw  string
	Path []string
	Act  string
	Op   string // cmp/arith op, or and/or
	Neg  bool   // for eq vs neq
	LHS  *Expr
	RHS  *Expr
	Arg  *Expr
	Args []*Expr
}

const (
	maxDepth                 = 10
	maxNodes                 = 100
	maxPathSegments          = 6
	maxPathSegmentsBracketed = 7
	maxExpressionCost        = 1000
)
