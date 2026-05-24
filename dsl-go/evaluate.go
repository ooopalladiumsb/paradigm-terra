package dsl

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Bindings holds the state/params roots an expression may read.
type Bindings struct {
	vals map[string]canonical.Value
}

// BindingsFromJcs builds bindings from a JcsValue object keyed by binding root.
func BindingsFromJcs(j canonical.Value) Bindings {
	b := Bindings{vals: map[string]canonical.Value{}}
	if o, ok := j.(*canonical.Object); ok {
		for _, k := range []string{"state", "before", "after", "params", "capability", "signatures"} {
			if v, ok := o.Get(k); ok {
				b.vals[k] = v
			}
		}
	}
	return b
}

// Outcome is the unified normative result.
type Outcome struct {
	Code   string
	Reason string
}

func requireInt(v Value) (*big.Int, *DslError) {
	switch v.Kind {
	case "int256":
		return v.I, nil
	case "null":
		return nil, rerr("NULL_MISUSE")
	default:
		return nil, verr("TYPE_MISMATCH")
	}
}

func requireBool(v Value) (bool, *DslError) {
	switch v.Kind {
	case "bool":
		return v.B, nil
	case "null":
		return false, rerr("NULL_MISUSE")
	default:
		return false, verr("TYPE_MISMATCH")
	}
}

func requireString(v Value) (string, *DslError) {
	switch v.Kind {
	case "string":
		return v.S, nil
	case "null":
		return "", rerr("NULL_MISUSE")
	default:
		return "", verr("TYPE_MISMATCH")
	}
}

func checkRange(v *big.Int) (Value, *DslError) {
	if !inInt256Range(v) {
		return Value{}, rerr("OVERFLOW")
	}
	return Value{Kind: "int256", I: v}, nil
}

func resolvePath(path []string, b Bindings, scope Scope) (Value, *DslError) {
	root := path[0]
	var key string
	var rest []string
	switch root {
	case "params", "capability", "signatures":
		key, rest = root, path[1:]
	case "state":
		switch {
		case len(path) > 1 && path[1] == "before":
			key, rest = "before", path[2:]
		case len(path) > 1 && path[1] == "after":
			key, rest = "after", path[2:]
		case scope == ScopePostCondition || scope == ScopeInvariant:
			key, rest = "before", path[1:]
		default:
			key, rest = "state", path[1:]
		}
	default:
		return Value{}, rerr("MISSING_VAR")
	}

	cur, ok := b.vals[key]
	if !ok {
		return Value{}, rerr("MISSING_VAR")
	}
	for _, seg := range rest {
		o, ok := cur.(*canonical.Object)
		if !ok {
			return Value{}, rerr("MISSING_VAR")
		}
		v, ok := o.Get(seg)
		if !ok {
			return Value{}, rerr("MISSING_VAR")
		}
		cur = v
	}
	return materialize(cur)
}

func evalNode(e *Expr, b Bindings, scope Scope) (Value, *DslError) {
	switch e.Node {
	case "const":
		return constValue(e.CV)
	case "var":
		return resolvePath(e.Path, b, scope)
	case "action":
		return Value{Kind: "string", S: e.Act}, nil
	case "eq":
		l, err := evalNode(e.LHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		r, err := evalNode(e.RHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		eq, err := valuesEqual(l, r)
		if err != nil {
			return Value{}, err
		}
		if e.Neg {
			eq = !eq
		}
		return Value{Kind: "bool", B: eq}, nil
	case "cmp":
		l, err := evalInt(e.LHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		r, err := evalInt(e.RHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		c := l.Cmp(r)
		var res bool
		switch e.Op {
		case "lt":
			res = c < 0
		case "lte":
			res = c <= 0
		case "gt":
			res = c > 0
		default:
			res = c >= 0
		}
		return Value{Kind: "bool", B: res}, nil
	case "arith":
		l, err := evalInt(e.LHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		r, err := evalInt(e.RHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		switch e.Op {
		case "add":
			return checkRange(new(big.Int).Add(l, r))
		case "sub":
			return checkRange(new(big.Int).Sub(l, r))
		case "mul":
			return checkRange(new(big.Int).Mul(l, r))
		case "div":
			if r.Sign() == 0 {
				return Value{}, rerr("DIV_BY_ZERO")
			}
			return checkRange(new(big.Int).Quo(l, r)) // MIN/-1 -> 2^255 -> OVERFLOW
		default: // mod
			if r.Sign() == 0 {
				return Value{}, rerr("MOD_BY_ZERO")
			}
			return Value{Kind: "int256", I: new(big.Int).Mod(l, r)}, nil // Euclidean
		}
	case "bool":
		return evalBoolean(e, b, scope)
	case "not":
		bv, err := evalBool(e.Arg, b, scope)
		if err != nil {
			return Value{}, err
		}
		return Value{Kind: "bool", B: !bv}, nil
	case "contains_key":
		m, err := evalNode(e.LHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		if m.Kind == "null" {
			return Value{}, rerr("NULL_MISUSE")
		}
		if m.Kind != "map" {
			return Value{}, verr("TYPE_MISMATCH")
		}
		kv, err := evalNode(e.RHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		k, err := keyForm(kv)
		if err != nil {
			return Value{}, err
		}
		found := false
		for _, ent := range m.Map {
			if ent.k == k {
				found = true
				break
			}
		}
		return Value{Kind: "bool", B: found}, nil
	case "size":
		v, err := evalNode(e.Arg, b, scope)
		if err != nil {
			return Value{}, err
		}
		switch v.Kind {
		case "list":
			return Value{Kind: "int256", I: big.NewInt(int64(len(v.List)))}, nil
		case "map":
			return Value{Kind: "int256", I: big.NewInt(int64(len(v.Map)))}, nil
		case "null":
			return Value{Kind: "int256", I: big.NewInt(0)}, nil
		default:
			return Value{}, verr("TYPE_MISMATCH")
		}
	case "requires_scope":
		a, err := evalString(e.LHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		s, err := evalString(e.RHS, b, scope)
		if err != nil {
			return Value{}, err
		}
		return Value{Kind: "bool", B: requiresScope(a, s)}, nil
	case "is_owner_required":
		a, err := evalString(e.Arg, b, scope)
		if err != nil {
			return Value{}, err
		}
		return Value{Kind: "bool", B: isOwnerRequired(a)}, nil
	}
	return Value{}, rerr("INTERNAL")
}

func evalInt(e *Expr, b Bindings, scope Scope) (*big.Int, *DslError) {
	v, err := evalNode(e, b, scope)
	if err != nil {
		return nil, err
	}
	return requireInt(v)
}

func evalBool(e *Expr, b Bindings, scope Scope) (bool, *DslError) {
	v, err := evalNode(e, b, scope)
	if err != nil {
		return false, err
	}
	return requireBool(v)
}

func evalString(e *Expr, b Bindings, scope Scope) (string, *DslError) {
	v, err := evalNode(e, b, scope)
	if err != nil {
		return "", err
	}
	return requireString(v)
}

// evalBoolean evaluates every argument (no short-circuit). ERROR dominates
// VALIDATION_ERROR; within a class the first argument wins.
func evalBoolean(e *Expr, b Bindings, scope Scope) (Value, *DslError) {
	type res struct {
		v   Value
		err *DslError
	}
	results := make([]res, 0, len(e.Args))
	for _, a := range e.Args {
		v, err := evalNode(a, b, scope)
		results = append(results, res{v, err})
	}
	for _, r := range results {
		if r.err != nil && r.err.Phase == PhaseRuntime {
			return Value{}, r.err
		}
	}
	for _, r := range results {
		if r.err != nil && r.err.Phase == PhaseValidation {
			return Value{}, r.err
		}
	}
	acc := e.Op == "and"
	for _, r := range results {
		bv, err := requireBool(r.v)
		if err != nil {
			return Value{}, err
		}
		if e.Op == "and" {
			acc = acc && bv
		} else {
			acc = acc || bv
		}
	}
	return Value{Kind: "bool", B: acc}, nil
}

func evaluate(e *Expr, b Bindings, scope Scope) Outcome {
	v, err := evalNode(e, b, scope)
	if err != nil {
		return Outcome{Code: err.Phase.Code(), Reason: err.Reason}
	}
	if v.Kind != "bool" {
		return Outcome{Code: "VALIDATION_ERROR", Reason: "NON_BOOLEAN_RESULT"}
	}
	if v.B {
		return Outcome{Code: "EVALUATION_TRUE"}
	}
	return Outcome{Code: "EVALUATION_FALSE"}
}

// Run parses + evaluates, returning the unified normative outcome.
func Run(j canonical.Value, scope Scope, version Version, b Bindings) Outcome {
	expr, err := ParseExpression(j, scope, version)
	if err != nil {
		return Outcome{Code: err.Phase.Code(), Reason: err.Reason}
	}
	return evaluate(expr, b, scope)
}
