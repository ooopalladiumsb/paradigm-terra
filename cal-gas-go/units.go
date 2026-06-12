package calgas

import (
	"math/big"
	"strings"

	canonical "github.com/paradigm-terra/canonical-go"
	dsl "github.com/paradigm-terra/dsl-go"
)

// Gas-unit model (CAL Spec §9.2). The DSL portion is delegated to
// dsl.ExpressionCost, so it is byte-for-byte the same numbers the DSL layer
// already pins. MCP and rent costs layer on top. All units uint256.
const (
	MCPRead          = 50  // get_*  MCP call
	MCPWrite         = 200 // any other (mutating) MCP call
	InvariantBase    = 5   // per invariant expression, plus its DSL cost
	StateRentPerByte = 1
	// PFC2-M4 (Multisig v2.1, §9.2): owner-authorization verification weight, linear in the number
	// of owner signatures actually verified (NOT the owner-set size). The operator signature is
	// unpriced (one raw verify, exactly as v1) — multisig prices only the owner model it introduces.
	OwnerAuthBase       = 50  // fixed setup for the owner-authorization check (k >= 1)
	ED25519VerifyWeight = 100 // per verified owner signature (one Ed25519 verify)
)

// OwnerAuthUnits is PFC2-M4 §9.2 owner-authorization gas, linear in k = owner signatures verified.
// 0 when the action is not owner-gated, so the operator-only path keeps its exact v1 cost. A v1
// single-owner action and its migrated 1-of-1 form both have k = 1 ⇒ identical price (SC-4).
// Mirrors ownerAuthUnits.
func OwnerAuthUnits(k uint64) *big.Int {
	if k == 0 {
		return big.NewInt(0)
	}
	return new(big.Int).SetUint64(OwnerAuthBase + k*ED25519VerifyWeight)
}

// dslCost is the cost of one embedded DSL expression. A bare AST is read as
// v1.2; a {dsl_version, expr} envelope overrides the version (mirrors dslCost +
// parseEnvelope in the TS reference).
func dslCost(node canonical.Value, present bool, scope dsl.Scope) (*big.Int, *GasError) {
	version := dsl.V12
	expr := node
	exprPresent := present
	if present {
		if o, ok := node.(*canonical.Object); ok {
			if _, has := o.Get("dsl_version"); has {
				dv, _ := o.Get("dsl_version")
				switch s, _ := dv.(string); s {
				case "1.1":
					version = dsl.V11
				case "1.2":
					version = dsl.V12
				default:
					return nil, gerr("VALIDATION_ERROR", "UNSUPPORTED_VERSION")
				}
				e, has2 := o.Get("expr")
				if !has2 {
					return nil, gerr("PARSE_ERROR", "MALFORMED_ENVELOPE")
				}
				expr = e
				exprPresent = true
			}
		}
	}
	if !exprPresent {
		return nil, gerr("PARSE_ERROR", "MALFORMED_NODE")
	}
	c, e := dsl.ExpressionCost(expr, scope, version)
	if e != nil {
		return nil, fromDsl(e)
	}
	return big.NewInt(c), nil
}

// MCPCallUnits returns the MCP-call units for a step verb: get_* is a read (50),
// everything else a write (200).
func MCPCallUnits(verb string) *big.Int {
	parts := strings.Split(verb, ".")
	part := ""
	if len(parts) > 1 {
		part = parts[1]
	}
	if strings.HasPrefix(part, "get_") {
		return big.NewInt(MCPRead)
	}
	return big.NewInt(MCPWrite)
}

// EffectsBytes is the byte length of the committed effects' canonical
// serialization (state rent input).
func EffectsBytes(effects canonical.Value) (*big.Int, error) {
	b, err := canonical.CanonicalizeValue(effects)
	if err != nil {
		return nil, err
	}
	return big.NewInt(int64(len(b))), nil
}

// StaticGasUnits returns the data-independent gas units of a CAL (everything
// except state rent): preconditions DSL cost + per-step (1 MCP call +
// post-condition DSL cost) + per-invariant (base 5 + DSL cost).
func StaticGasUnits(cal canonical.Value) (*big.Int, *GasError) {
	pre, ok := getIn(cal, []string{"preconditions"})
	total, e := dslCost(pre, ok, dsl.ScopePrecondition)
	if e != nil {
		return nil, e
	}
	total = new(big.Int).Set(total)

	if steps, ok := getIn(cal, []string{"steps"}); ok {
		if arr, ok := steps.([]canonical.Value); ok {
			for _, step := range arr {
				if verbV, ok := getIn(step, []string{"verb"}); ok {
					if verb, ok := verbV.(string); ok {
						total.Add(total, MCPCallUnits(verb))
					}
				}
				if pcs, ok := getIn(step, []string{"post_conditions"}); ok {
					if pcArr, ok := pcs.([]canonical.Value); ok {
						for _, pc := range pcArr {
							c, e := dslCost(pc, true, dsl.ScopePostCondition)
							if e != nil {
								return nil, e
							}
							total.Add(total, c)
						}
					}
				}
			}
		}
	}

	if invs, ok := getIn(cal, []string{"invariants"}); ok {
		if invArr, ok := invs.([]canonical.Value); ok {
			for _, inv := range invArr {
				c, e := dslCost(inv, true, dsl.ScopeInvariant)
				if e != nil {
					return nil, e
				}
				total.Add(total, big.NewInt(InvariantBase))
				total.Add(total, c)
			}
		}
	}
	return total, nil
}

// GasUnits returns total gas units = static units + state rent (1 per byte) + owner-auth weight.
// ownerAuth (PFC2-M4, from OwnerAuthUnits(k)) is 0 for every non-owner-gated CAL, so those stay
// byte-for-byte the v1 cost. Mirrors gasUnits(cal, bytes, ownerAuth=0).
func GasUnits(cal canonical.Value, bytesWritten *big.Int, ownerAuth *big.Int) (*big.Int, *GasError) {
	su, e := StaticGasUnits(cal)
	if e != nil {
		return nil, e
	}
	rent := new(big.Int).Mul(bytesWritten, big.NewInt(StateRentPerByte))
	total := new(big.Int).Add(su, rent)
	return total.Add(total, ownerAuth), nil
}
