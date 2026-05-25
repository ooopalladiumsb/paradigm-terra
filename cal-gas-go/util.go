package calgas

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

// uint256 upper bound.
var uint256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))

// getIn reads a value at a path of object keys; ok=false if any segment is
// missing or a non-object is encountered (mirrors getIn in util.ts).
func getIn(v canonical.Value, path []string) (canonical.Value, bool) {
	cur := v
	for _, seg := range path {
		o, ok := cur.(*canonical.Object)
		if !ok {
			return nil, false
		}
		cv, ok := o.Get(seg)
		if !ok {
			return nil, false
		}
		cur = cv
	}
	return cur, true
}

// readBig reads an integer field at path as uint256, falling back to def when
// absent/non-integer/out-of-range (mirrors asBig: a canonical integer parses,
// anything else falls back). def is returned as-is, so callers pass a fresh
// big.Int they are willing to hand out.
func readBig(v canonical.Value, path []string, def *big.Int) *big.Int {
	cur, ok := getIn(v, path)
	if !ok {
		return def
	}
	iv, isInt := cur.(canonical.Int)
	if !isInt {
		return def
	}
	n, good := new(big.Int).SetString(string(iv), 10)
	if !good || n.Sign() < 0 || n.Cmp(uint256Max) > 0 {
		return def
	}
	return n
}
