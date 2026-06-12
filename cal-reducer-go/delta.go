package calreducer

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

// uint256 upper bound.
var uint256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))

func asU256(v canonical.Value) (*big.Int, bool) {
	iv, ok := v.(canonical.Int)
	if !ok {
		return nil, false
	}
	n, ok := new(big.Int).SetString(string(iv), 10)
	if !ok || n.Sign() < 0 || n.Cmp(uint256Max) > 0 {
		return nil, false
	}
	return n, true
}

func intVal(n *big.Int) canonical.Value { return canonical.Int(n.String()) }

// applyDeltaJSON validates + applies one Delta (a canonical {ns,op,path,value?}).
func applyDeltaJSON(state, d canonical.Value) (canonical.Value, *ApplyError) {
	o, ok := d.(*canonical.Object)
	if !ok {
		return nil, aerr("BAD_DELTA")
	}
	nsv, _ := o.Get("ns")
	opv, _ := o.Get("op")
	pathv, _ := o.Get("path")
	ns, ok1 := nsv.(string)
	op, ok2 := opv.(string)
	pathArr, ok3 := pathv.([]canonical.Value)
	if !ok1 || !ok2 || !ok3 {
		return nil, aerr("BAD_DELTA")
	}
	full := []string{ns}
	for _, pv := range pathArr {
		ps, ok := pv.(string)
		if !ok {
			return nil, aerr("BAD_DELTA")
		}
		full = append(full, ps)
	}

	switch op {
	case "set":
		val, _ := o.Get("value")
		next := setIn(state, full, val)
		if e := enforceOwnerRecord(next, full); e != nil {
			return nil, e
		}
		return next, nil
	case "delete":
		return deleteIn(state, full), nil
	case "add", "sub":
		var cur *big.Int
		if c, ok := getIn(state, full); ok {
			n, okn := asU256(c)
			if !okn {
				return nil, aerr("BAD_DELTA")
			}
			cur = n
		} else {
			cur = big.NewInt(0)
		}
		vv, ok := o.Get("value")
		if !ok {
			return nil, aerr("BAD_DELTA")
		}
		val, okv := asU256(vv)
		if !okv {
			return nil, aerr("BAD_DELTA")
		}
		res := new(big.Int)
		if op == "add" {
			res.Add(cur, val)
			if res.Cmp(uint256Max) > 0 {
				return nil, aerr("OVERFLOW")
			}
		} else {
			res.Sub(cur, val)
			if res.Sign() < 0 {
				return nil, aerr("UNDERFLOW")
			}
		}
		return setIn(state, full, intVal(res)), nil
	default:
		return nil, aerr("BAD_DELTA")
	}
}
