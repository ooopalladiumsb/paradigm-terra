package dsl

import (
	"strconv"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Constitutionally injected Bounded-Mode invariants (DSL v1.2 §7.1, CAL §10.3).
//
// When state.failure_mode.is_bounded_mode == true at VALIDATED time, the runtime
// injects this exact set on top of whatever invariants the CAL declares. The set
// is deterministically derived by every validator from the flag alone, so it is
// NOT part of the CAL hash but IS part of consensus (DSL v1.2 §7.2). Mirrors
// dsl/src/emergency.ts byte-for-byte under canonical JCS.

func vRef(path string) canonical.Value {
	return canonical.NewObject(canonical.P("var", path))
}

func vConstInt(n int64) canonical.Value {
	return canonical.NewObject(canonical.P("const", canonical.Int(strconv.FormatInt(n, 10))))
}

func vConstBool(b bool) canonical.Value {
	return canonical.NewObject(canonical.P("const", b))
}

func opBinary(op string, lhs, rhs canonical.Value) canonical.Value {
	return canonical.NewObject(
		canonical.P("op", op),
		canonical.P("lhs", lhs),
		canonical.P("rhs", rhs),
	)
}

// EmergencyInvariants returns the three injected invariants, in canonical
// declaration order.
func EmergencyInvariants() []canonical.Value {
	return []canonical.Value{
		opBinary("gte",
			vRef("state.after.treasury.developer_fund_balance"),
			vRef("state.before.treasury.developer_fund_balance"),
		),
		opBinary("gte",
			vRef("state.after.treasury.nav"),
			opBinary("sub", vRef("state.before.treasury.nav"), vConstInt(0)),
		),
		opBinary("eq",
			vRef("state.after.failure_mode.is_bounded_mode"),
			vConstBool(true),
		),
	}
}

// EffectiveInvariants returns declared invariants plus the emergency set when bounded.
func EffectiveInvariants(declared []canonical.Value, isBoundedMode bool) []canonical.Value {
	if !isBoundedMode {
		out := make([]canonical.Value, len(declared))
		copy(out, declared)
		return out
	}
	em := EmergencyInvariants()
	out := make([]canonical.Value, 0, len(declared)+len(em))
	out = append(out, declared...)
	out = append(out, em...)
	return out
}
