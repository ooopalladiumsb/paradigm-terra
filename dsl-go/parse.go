package dsl

import (
	"math/big"
	"strings"

	canonical "github.com/paradigm-terra/canonical-go"
)

const (
	costBinary      = 1
	costContainsKey = 10
	costSize        = 20
	costGateOp      = 5
	costPathSegment = 2
)

type parseCtx struct {
	scope   Scope
	version Version
	nodes   int
	cost    int64
}

func asObject(j canonical.Value) (*canonical.Object, bool) {
	o, ok := j.(*canonical.Object)
	return o, ok
}

func (c *parseCtx) bumpNode() *DslError {
	c.nodes++
	if c.nodes > maxNodes {
		return perr("NODE_LIMIT")
	}
	return nil
}

func (c *parseCtx) addCost(n int64) *DslError {
	c.cost += n
	if c.cost > maxExpressionCost {
		return verr("COST_EXCEEDED")
	}
	return nil
}

func isAddressShaped(s string) bool {
	colon := strings.IndexByte(s, ':')
	if colon < 0 {
		return false
	}
	wc, hash := s[:colon], s[colon+1:]
	if len(hash) != 64 {
		return false
	}
	for i := 0; i < 64; i++ {
		c := hash[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	wc = strings.TrimPrefix(wc, "-")
	if wc == "" {
		return false
	}
	for i := 0; i < len(wc); i++ {
		if wc[i] < '0' || wc[i] > '9' {
			return false
		}
	}
	return true
}

func buildConst(value canonical.Value) (*Expr, *DslError) {
	switch v := value.(type) {
	case canonical.Int:
		bi, ok := new(big.Int).SetString(string(v), 10)
		if !ok || !inInt256Range(bi) {
			return nil, verr("INT256_RANGE")
		}
		return &Expr{Node: "const", CV: ConstVal{Typ: "int256", I: bi}}, nil
	case bool:
		return &Expr{Node: "const", CV: ConstVal{Typ: "bool", B: v}}, nil
	case nil:
		return &Expr{Node: "const", CV: ConstVal{Typ: "null"}}, nil
	case string:
		if isBytes32(v) {
			return &Expr{Node: "const", CV: ConstVal{Typ: "bytes32", S: "0x" + strings.ToLower(v[2:])}}, nil
		}
		if isAddressShaped(v) {
			return &Expr{Node: "const", CV: ConstVal{Typ: "address", S: v}}, nil
		}
		return &Expr{Node: "const", CV: ConstVal{Typ: "string", S: v}}, nil
	default:
		return nil, verr("NO_COLLECTION_LITERAL")
	}
}

func (c *parseCtx) buildVar(raw string) (*Expr, *DslError) {
	if raw == "" || strings.HasPrefix(raw, ".") || strings.HasSuffix(raw, ".") || strings.Contains(raw, "..") {
		return nil, perr("MALFORMED_PATH")
	}
	path := strings.Split(raw, ".")
	root := path[0]
	bracketed := root == "state" && len(path) > 1 && (path[1] == "before" || path[1] == "after")

	limit := maxPathSegments
	if bracketed {
		limit = maxPathSegmentsBracketed
	}
	if len(path) > limit {
		return nil, perr("PATH_TOO_DEEP")
	}

	switch root {
	case "params":
	case "state":
		if bracketed {
			if c.scope != ScopePostCondition && c.scope != ScopeInvariant {
				return nil, perr("BRACKETED_STATE_OUT_OF_SCOPE")
			}
			if c.version == V11 {
				return nil, verr("V11_UNSUPPORTED")
			}
		}
	case "capability", "signatures":
		if c.scope != ScopeGate {
			return nil, perr("GATE_VAR_OUT_OF_SCOPE")
		}
	default:
		return nil, perr("UNKNOWN_VAR_ROOT")
	}

	if e := c.addCost(costPathSegment * int64(len(path))); e != nil {
		return nil, e
	}
	return &Expr{Node: "var", Raw: raw, Path: path}, nil
}

func (c *parseCtx) buildAction(value canonical.Value) (*Expr, *DslError) {
	a, ok := value.(string)
	if !ok {
		return nil, perr("MALFORMED_ACTION")
	}
	if c.scope != ScopeGate {
		return nil, perr("ACTION_OUT_OF_SCOPE")
	}
	if c.version == V11 {
		return nil, verr("V11_UNSUPPORTED")
	}
	if !isRegisteredAction(a) {
		return nil, perr("UNKNOWN_ACTION")
	}
	return &Expr{Node: "action", Act: a}, nil
}

func requireKeys(keys []string, allowed ...string) *DslError {
	for _, k := range keys {
		found := false
		for _, a := range allowed {
			if k == a {
				found = true
				break
			}
		}
		if !found {
			return verr("UNEXPECTED_KEY")
		}
	}
	return nil
}

func (c *parseCtx) buildOp(o *canonical.Object, depth int) (*Expr, *DslError) {
	opv, _ := o.Get("op")
	op, ok := opv.(string)
	if !ok {
		return nil, perr("MALFORMED_NODE")
	}
	keys := o.Keys()

	child := func(key string) (*Expr, *DslError) {
		cv, _ := o.Get(key)
		return c.build(cv, depth+1)
	}

	arith := op == "add" || op == "sub" || op == "mul" || op == "div" || op == "mod"
	cmp := op == "lt" || op == "lte" || op == "gt" || op == "gte"
	if arith || cmp || op == "eq" || op == "neq" {
		if e := requireKeys(keys, "op", "lhs", "rhs"); e != nil {
			return nil, e
		}
		_, hasL := o.Get("lhs")
		_, hasR := o.Get("rhs")
		if !hasL || !hasR {
			return nil, verr("ARITY")
		}
		if e := c.addCost(costBinary); e != nil {
			return nil, e
		}
		lhs, e := child("lhs")
		if e != nil {
			return nil, e
		}
		rhs, e := child("rhs")
		if e != nil {
			return nil, e
		}
		switch {
		case arith:
			return &Expr{Node: "arith", Op: op, LHS: lhs, RHS: rhs}, nil
		case cmp:
			return &Expr{Node: "cmp", Op: op, LHS: lhs, RHS: rhs}, nil
		default:
			return &Expr{Node: "eq", Neg: op == "neq", LHS: lhs, RHS: rhs}, nil
		}
	}

	switch op {
	case "and", "or":
		if e := requireKeys(keys, "op", "args"); e != nil {
			return nil, e
		}
		args, ok := mustArgs(o)
		if !ok || len(args) < 2 {
			return nil, verr("ARITY")
		}
		if e := c.addCost(costBinary); e != nil {
			return nil, e
		}
		out := make([]*Expr, 0, len(args))
		for _, a := range args {
			ae, e := c.build(a, depth+1)
			if e != nil {
				return nil, e
			}
			out = append(out, ae)
		}
		return &Expr{Node: "bool", Op: op, Args: out}, nil
	case "not":
		if e := requireKeys(keys, "op", "arg"); e != nil {
			return nil, e
		}
		if _, ok := o.Get("arg"); !ok {
			return nil, verr("ARITY")
		}
		if e := c.addCost(costBinary); e != nil {
			return nil, e
		}
		arg, e := child("arg")
		if e != nil {
			return nil, e
		}
		return &Expr{Node: "not", Arg: arg}, nil
	case "size":
		if e := requireKeys(keys, "op", "arg"); e != nil {
			return nil, e
		}
		if _, ok := o.Get("arg"); !ok {
			return nil, verr("ARITY")
		}
		if e := c.addCost(costSize); e != nil {
			return nil, e
		}
		arg, e := child("arg")
		if e != nil {
			return nil, e
		}
		return &Expr{Node: "size", Arg: arg}, nil
	case "contains_key":
		if e := requireKeys(keys, "op", "lhs", "rhs"); e != nil {
			return nil, e
		}
		_, hasL := o.Get("lhs")
		_, hasR := o.Get("rhs")
		if !hasL || !hasR {
			return nil, verr("ARITY")
		}
		if e := c.addCost(costContainsKey); e != nil {
			return nil, e
		}
		m, e := child("lhs")
		if e != nil {
			return nil, e
		}
		k, e := child("rhs")
		if e != nil {
			return nil, e
		}
		return &Expr{Node: "contains_key", LHS: m, RHS: k}, nil
	case "requires_scope":
		if c.scope != ScopeGate {
			return nil, perr("GATE_OP_OUT_OF_SCOPE")
		}
		if c.version == V11 {
			return nil, verr("V11_UNSUPPORTED")
		}
		if e := requireKeys(keys, "op", "args"); e != nil {
			return nil, e
		}
		args, e := expectArgs(o, 2)
		if e != nil {
			return nil, e
		}
		if e := c.addCost(costGateOp); e != nil {
			return nil, e
		}
		action, e := c.build(args[0], depth+1)
		if e != nil {
			return nil, e
		}
		scope, e := c.build(args[1], depth+1)
		if e != nil {
			return nil, e
		}
		return &Expr{Node: "requires_scope", LHS: action, RHS: scope}, nil
	case "is_owner_required":
		if c.scope != ScopeGate {
			return nil, perr("GATE_OP_OUT_OF_SCOPE")
		}
		if c.version == V11 {
			return nil, verr("V11_UNSUPPORTED")
		}
		if e := requireKeys(keys, "op", "args"); e != nil {
			return nil, e
		}
		args, e := expectArgs(o, 1)
		if e != nil {
			return nil, e
		}
		if e := c.addCost(costGateOp); e != nil {
			return nil, e
		}
		action, e := c.build(args[0], depth+1)
		if e != nil {
			return nil, e
		}
		return &Expr{Node: "is_owner_required", Arg: action}, nil
	default:
		return nil, verr("UNKNOWN_OPERATOR")
	}
}

func mustArgs(o *canonical.Object) ([]canonical.Value, bool) {
	v, ok := o.Get("args")
	if !ok {
		return nil, false
	}
	arr, ok := v.([]canonical.Value)
	return arr, ok
}

func expectArgs(o *canonical.Object, n int) ([]canonical.Value, *DslError) {
	args, ok := mustArgs(o)
	if !ok || len(args) != n {
		return nil, verr("ARITY")
	}
	return args, nil
}

func (c *parseCtx) build(j canonical.Value, depth int) (*Expr, *DslError) {
	if depth > maxDepth {
		return nil, perr("DEPTH_LIMIT")
	}
	if e := c.bumpNode(); e != nil {
		return nil, e
	}
	o, ok := asObject(j)
	if !ok {
		return nil, perr("MALFORMED_NODE")
	}

	_, hasConst := o.Get("const")
	_, hasVar := o.Get("var")
	_, hasAction := o.Get("action")
	_, hasOp := o.Get("op")
	count := 0
	for _, b := range []bool{hasConst, hasVar, hasAction, hasOp} {
		if b {
			count++
		}
	}
	if count != 1 {
		return nil, perr("MALFORMED_NODE")
	}

	keys := o.Keys()
	if hasConst {
		if len(keys) != 1 {
			return nil, perr("MALFORMED_NODE")
		}
		cv, _ := o.Get("const")
		return buildConst(cv)
	}
	if hasVar {
		if len(keys) != 1 {
			return nil, perr("MALFORMED_NODE")
		}
		rv, _ := o.Get("var")
		raw, ok := rv.(string)
		if !ok {
			return nil, perr("MALFORMED_NODE")
		}
		return c.buildVar(raw)
	}
	if hasAction {
		if len(keys) != 1 {
			return nil, perr("MALFORMED_NODE")
		}
		av, _ := o.Get("action")
		return c.buildAction(av)
	}
	return c.buildOp(o, depth)
}

// ParseExpression parses + validates an expression AST.
func ParseExpression(j canonical.Value, scope Scope, version Version) (*Expr, *DslError) {
	ctx := &parseCtx{scope: scope, version: version}
	return ctx.build(j, 1)
}

// ExpressionCost returns the static, data-independent cost of a parsed
// expression (DSL v1.1 §3.2, CAL §9.2). Mirrors expressionCost in parse.ts:
// validate the AST, then return the accumulated cost. The gas layer (cal-gas)
// reuses this so the DSL portion of a CAL's gas is the exact numbers the DSL
// already pins.
func ExpressionCost(j canonical.Value, scope Scope, version Version) (int64, *DslError) {
	ctx := &parseCtx{scope: scope, version: version}
	if _, e := ctx.build(j, 1); e != nil {
		return 0, e
	}
	return ctx.cost, nil
}
