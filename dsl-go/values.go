package dsl

import (
	"math/big"
	"strings"

	canonical "github.com/paradigm-terra/canonical-go"
)

// int256 bounds: [-2^255, 2^255 - 1].
var (
	int256Max = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(1))
	int256Min = new(big.Int).Neg(new(big.Int).Lsh(big.NewInt(1), 255))
)

func inInt256Range(v *big.Int) bool {
	return v.Cmp(int256Min) >= 0 && v.Cmp(int256Max) <= 0
}

// Value is a runtime DSL value.
type Value struct {
	Kind string // int256|bool|string|bytes32|address|list|map|null
	I    *big.Int
	B    bool
	S    string
	List []Value
	Map  []mapEntry
}

type mapEntry struct {
	k string
	v Value
}

func isHex(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func isBytes32(s string) bool {
	return len(s) == 66 && strings.HasPrefix(s, "0x") && isHex(s[2:])
}

func classifyString(s string) string {
	if canonical.IsCanonicalAddress(s) {
		return "address"
	}
	if isBytes32(s) {
		return "bytes32"
	}
	return "string"
}

func makeString(s string) (Value, *DslError) {
	if _, err := canonical.UTF8NFCBytes(s); err != nil {
		return Value{}, rerr("STRING_UNASSIGNED")
	}
	return Value{Kind: "string", S: s}, nil
}

func makeBytes32(s string) (Value, *DslError) {
	if !isBytes32(s) {
		return Value{}, verr("BYTES32_MALFORMED")
	}
	return Value{Kind: "bytes32", S: "0x" + strings.ToLower(s[2:])}, nil
}

func makeAddress(s string) (Value, *DslError) {
	if !canonical.IsCanonicalAddress(s) {
		return Value{}, verr("ADDRESS_NONCANONICAL")
	}
	return Value{Kind: "address", S: s}, nil
}

func constValue(c ConstVal) (Value, *DslError) {
	switch c.Typ {
	case "int256":
		return Value{Kind: "int256", I: c.I}, nil
	case "bool":
		return Value{Kind: "bool", B: c.B}, nil
	case "string":
		return makeString(c.S)
	case "bytes32":
		return makeBytes32(c.S)
	case "address":
		return makeAddress(c.S)
	default:
		return Value{Kind: "null"}, nil
	}
}

// materialize converts a bound JcsValue into a typed DSL Value.
func materialize(j canonical.Value) (Value, *DslError) {
	switch v := j.(type) {
	case nil:
		return Value{Kind: "null"}, nil
	case bool:
		return Value{Kind: "bool", B: v}, nil
	case canonical.Int:
		bi, ok := new(big.Int).SetString(string(v), 10)
		if !ok {
			return Value{}, rerr("UNREPRESENTABLE")
		}
		if !inInt256Range(bi) {
			return Value{}, verr("INT256_RANGE")
		}
		return Value{Kind: "int256", I: bi}, nil
	case string:
		switch classifyString(v) {
		case "address":
			return makeAddress(v)
		case "bytes32":
			return makeBytes32(v)
		default:
			return makeString(v)
		}
	case []canonical.Value:
		out := make([]Value, 0, len(v))
		for _, it := range v {
			mv, err := materialize(it)
			if err != nil {
				return Value{}, err
			}
			out = append(out, mv)
		}
		return Value{Kind: "list", List: out}, nil
	case *canonical.Object:
		out := make([]mapEntry, 0)
		for _, k := range v.Keys() {
			cv, _ := v.Get(k)
			mv, err := materialize(cv)
			if err != nil {
				return Value{}, err
			}
			out = append(out, mapEntry{k: k, v: mv})
		}
		return Value{Kind: "map", Map: out}, nil
	default:
		return Value{}, rerr("UNREPRESENTABLE")
	}
}

func keyForm(v Value) (string, *DslError) {
	switch v.Kind {
	case "string", "address", "bytes32":
		return v.S, nil
	default:
		return "", verr("KEY_TYPE")
	}
}

func nfcBytes(s string) ([]byte, *DslError) {
	b, err := canonical.UTF8NFCBytes(s)
	if err != nil {
		return nil, rerr("STRING_UNASSIGNED")
	}
	return b, nil
}

// valuesEqual is DSL structural equality (DSL v1.1 §3.3). Mixed non-null kinds
// are a VALIDATION_ERROR/TYPE_MISMATCH; null compares with anything.
func valuesEqual(a, b Value) (bool, *DslError) {
	if a.Kind == "null" || b.Kind == "null" {
		return a.Kind == "null" && b.Kind == "null", nil
	}
	if a.Kind != b.Kind {
		return false, verr("TYPE_MISMATCH")
	}
	switch a.Kind {
	case "int256":
		return a.I.Cmp(b.I) == 0, nil
	case "bool":
		return a.B == b.B, nil
	case "string":
		ab, e := nfcBytes(a.S)
		if e != nil {
			return false, e
		}
		bb, e := nfcBytes(b.S)
		if e != nil {
			return false, e
		}
		return string(ab) == string(bb), nil
	case "bytes32", "address":
		return a.S == b.S, nil
	case "list":
		if len(a.List) != len(b.List) {
			return false, nil
		}
		for i := range a.List {
			eq, e := valuesEqual(a.List[i], b.List[i])
			if e != nil {
				return false, e
			}
			if !eq {
				return false, nil
			}
		}
		return true, nil
	case "map":
		if len(a.Map) != len(b.Map) {
			return false, nil
		}
		for _, ae := range a.Map {
			found := false
			for _, be := range b.Map {
				if be.k == ae.k {
					eq, e := valuesEqual(ae.v, be.v)
					if e != nil {
						return false, e
					}
					if !eq {
						return false, nil
					}
					found = true
					break
				}
			}
			if !found {
				return false, nil
			}
		}
		return true, nil
	}
	return false, verr("TYPE_MISMATCH")
}
