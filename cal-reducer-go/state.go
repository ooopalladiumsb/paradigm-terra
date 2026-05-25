package calreducer

import (
	"strings"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Namespaces in the §7.3 UTF-8-sorted order (by `state.<name>`).
var Namespaces = []string{"cal", "failure_mode", "governance", "oracles", "ptra", "registry", "tick", "treasury"}

// Genesis is the fixed genesis state (its STATE_ROOT is pinned by the golden vectors).
func Genesis() canonical.Value {
	o, p, iu, a := canonical.O, canonical.P, canonical.IntU, canonical.A
	return o(
		p("cal", o(p("in_flight", o()), p("nonces", o()))),
		p("failure_mode", o(p("is_bounded_mode", false), p("capture_guard_counters", o()))),
		p("governance", o(p("gas_price_nano_ptra_per_unit", iu(1000)), p("genesis_validator_set", a()), p("params", o()))),
		p("oracles", o(p("feeds", o()))),
		p("ptra", o(p("balances", o()))),
		p("registry", o(p("agents", o()), p("mcp_schema_hash", "0x"+strings.Repeat("00", 32)))),
		p("tick", o(p("current", iu(0)))),
		p("treasury", o(p("nav", iu(0)), p("developer_fund_balance", iu(0)), p("collected_fees_window", iu(0)))),
	)
}

// StateRootOf computes the STATE_ROOT over the eight namespaces (CAL Spec §7.3).
func StateRootOf(state canonical.Value) ([32]byte, error) {
	nss := make([]canonical.StateNamespace, 0, len(Namespaces))
	for _, n := range Namespaces {
		content, _ := getIn(state, []string{n})
		b, err := canonical.CanonicalizeValue(content)
		if err != nil {
			return [32]byte{}, err
		}
		nss = append(nss, canonical.StateNamespace{Name: "state." + n, CanonicalBytes: b})
	}
	return canonical.StateRoot(nss)
}

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

func setIn(v canonical.Value, path []string, newval canonical.Value) canonical.Value {
	if len(path) == 0 {
		return newval
	}
	head := path[0]
	o, _ := v.(*canonical.Object)
	var pairs []canonical.Pair
	found := false
	if o != nil {
		for _, k := range o.Keys() {
			cv, _ := o.Get(k)
			if k == head {
				pairs = append(pairs, canonical.P(head, setIn(cv, path[1:], newval)))
				found = true
			} else {
				pairs = append(pairs, canonical.P(k, cv))
			}
		}
	}
	if !found {
		pairs = append(pairs, canonical.P(head, setIn(nil, path[1:], newval)))
	}
	return canonical.NewObject(pairs...)
}

func deleteIn(v canonical.Value, path []string) canonical.Value {
	o, ok := v.(*canonical.Object)
	if !ok {
		return v
	}
	var pairs []canonical.Pair
	for _, k := range o.Keys() {
		cv, _ := o.Get(k)
		if len(path) == 1 {
			if k == path[0] {
				continue
			}
			pairs = append(pairs, canonical.P(k, cv))
		} else if k == path[0] {
			pairs = append(pairs, canonical.P(k, deleteIn(cv, path[1:])))
		} else {
			pairs = append(pairs, canonical.P(k, cv))
		}
	}
	return canonical.NewObject(pairs...)
}
