package calreducer

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
)

func evStr(ev canonical.Value, k string) (string, *ApplyError) {
	v, ok := getIn(ev, []string{k})
	if !ok {
		return "", aerr("BAD_DELTA")
	}
	s, ok := v.(string)
	if !ok {
		return "", aerr("BAD_DELTA")
	}
	return s, nil
}
func evUint(ev canonical.Value, k string) (*big.Int, *ApplyError) {
	v, ok := getIn(ev, []string{k})
	if !ok {
		return nil, aerr("BAD_DELTA")
	}
	n, ok := asU256(v)
	if !ok {
		return nil, aerr("BAD_DELTA")
	}
	return n, nil
}
func optUint(ev canonical.Value, k string) (*big.Int, *ApplyError) {
	if _, ok := getIn(ev, []string{k}); ok {
		return evUint(ev, k)
	}
	return big.NewInt(0), nil
}
func u256At(state canonical.Value, path []string) *big.Int {
	if v, ok := getIn(state, path); ok {
		if n, ok := asU256(v); ok {
			return n
		}
	}
	return big.NewInt(0)
}
func stageOf(h canonical.Value) string {
	if v, ok := getIn(h, []string{"stage"}); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
func bumpNonce(state canonical.Value, agent string) canonical.Value {
	cur := u256At(state, []string{"cal", "nonces", agent})
	return setIn(state, []string{"cal", "nonces", agent}, intVal(new(big.Int).Add(cur, big.NewInt(1))))
}
func addFees(state canonical.Value, amount *big.Int) (canonical.Value, *ApplyError) {
	res := new(big.Int).Add(u256At(state, []string{"treasury", "collected_fees_window"}), amount)
	if res.Cmp(uint256Max) > 0 {
		return nil, aerr("OVERFLOW")
	}
	return setIn(state, []string{"treasury", "collected_fees_window"}, intVal(res)), nil
}
func recomputeBounded(state canonical.Value) canonical.Value {
	bounded := false
	if tv, ok := getIn(state, []string{"governance", "params", "capture_guard_threshold"}); ok {
		if threshold, ok := asU256(tv); ok {
			if cv, ok := getIn(state, []string{"failure_mode", "capture_guard_counters"}); ok {
				if o, ok := cv.(*canonical.Object); ok {
					for _, k := range o.Keys() {
						val, _ := o.Get(k)
						if n, ok := asU256(val); ok && n.Cmp(threshold) >= 0 {
							bounded = true
						}
					}
				}
			}
		}
	}
	return setIn(state, []string{"failure_mode", "is_bounded_mode"}, bounded)
}

// Apply applies one event. Total: returns (nil, *ApplyError) rather than panicking.
func Apply(state, ev canonical.Value) (canonical.Value, *ApplyError) {
	etypeV, ok := getIn(ev, []string{"event_type"})
	etype, ok2 := etypeV.(string)
	if !ok || !ok2 {
		return nil, aerr("UNKNOWN_EVENT")
	}

	switch etype {
	case "cal.created":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		agent, e := evStr(ev, "agent_id")
		if e != nil {
			return nil, e
		}
		if _, ok := getIn(state, []string{"cal", "in_flight", ch}); ok {
			return nil, aerr("DUPLICATE_CAL")
		}
		if all, ok := getIn(state, []string{"cal", "in_flight"}); ok {
			if o, ok := all.(*canonical.Object); ok {
				for _, k := range o.Keys() {
					h, _ := o.Get(k)
					if a, ok := getIn(h, []string{"agent_id"}); ok && a == agent {
						return nil, aerr("AGENT_BUSY")
					}
				}
			}
		}
		entry := canonical.O(
			canonical.P("agent_id", agent),
			canonical.P("stage", "CREATED"),
			canonical.P("fee_debited_ptra", canonical.IntU(0)),
			canonical.P("gas_consumed_ptra", canonical.IntU(0)),
			canonical.P("staged", canonical.A()),
		)
		return setIn(state, []string{"cal", "in_flight", ch}, entry), nil

	case "cal.signed":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		h, ok := getIn(state, []string{"cal", "in_flight", ch})
		if !ok {
			return nil, aerr("UNKNOWN_CAL")
		}
		if stageOf(h) != "CREATED" {
			return nil, aerr("BAD_STAGE")
		}
		return setIn(state, []string{"cal", "in_flight", ch, "stage"}, "SIGNED"), nil

	case "cal.validated":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		h, ok := getIn(state, []string{"cal", "in_flight", ch})
		if !ok {
			return nil, aerr("UNKNOWN_CAL")
		}
		if stageOf(h) != "SIGNED" {
			return nil, aerr("BAD_STAGE")
		}
		agent, _ := getIn(h, []string{"agent_id"})
		agentS, _ := agent.(string)
		fee, e := evUint(ev, "fee_debited_ptra")
		if e != nil {
			return nil, e
		}
		nb := new(big.Int).Sub(u256At(state, []string{"ptra", "balances", agentS}), fee)
		if nb.Sign() < 0 {
			return nil, aerr("INSUFFICIENT_BALANCE")
		}
		s := setIn(state, []string{"ptra", "balances", agentS}, intVal(nb))
		s = setIn(s, []string{"cal", "in_flight", ch, "fee_debited_ptra"}, intVal(fee))
		return setIn(s, []string{"cal", "in_flight", ch, "stage"}, "VALIDATED"), nil

	case "cal.executed":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		h, ok := getIn(state, []string{"cal", "in_flight", ch})
		if !ok {
			return nil, aerr("UNKNOWN_CAL")
		}
		if stageOf(h) != "VALIDATED" {
			return nil, aerr("BAD_STAGE")
		}
		effects, ok := getIn(ev, []string{"effects"})
		if !ok {
			return nil, aerr("BAD_DELTA")
		}
		if _, ok := effects.([]canonical.Value); !ok {
			return nil, aerr("BAD_DELTA")
		}
		gas, e := evUint(ev, "gas_consumed_ptra")
		if e != nil {
			return nil, e
		}
		s := setIn(state, []string{"cal", "in_flight", ch, "staged"}, effects)
		s = setIn(s, []string{"cal", "in_flight", ch, "gas_consumed_ptra"}, intVal(gas))
		return setIn(s, []string{"cal", "in_flight", ch, "stage"}, "EXECUTED"), nil

	case "cal.settled":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		h, ok := getIn(state, []string{"cal", "in_flight", ch})
		if !ok {
			return nil, aerr("UNKNOWN_CAL")
		}
		if stageOf(h) != "EXECUTED" {
			return nil, aerr("BAD_STAGE")
		}
		return setIn(state, []string{"cal", "in_flight", ch, "stage"}, "SETTLED"), nil

	case "cal.finalized":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		h, ok := getIn(state, []string{"cal", "in_flight", ch})
		if !ok {
			return nil, aerr("UNKNOWN_CAL")
		}
		if stageOf(h) != "SETTLED" {
			return nil, aerr("BAD_STAGE")
		}
		agentV, _ := getIn(h, []string{"agent_id"})
		agent, _ := agentV.(string)
		fee := u256At(state, []string{"cal", "in_flight", ch, "fee_debited_ptra"})
		gas := u256At(state, []string{"cal", "in_flight", ch, "gas_consumed_ptra"})
		refund, e := optUint(ev, "gas_refunded_ptra")
		if e != nil {
			return nil, e
		}
		s := state
		if stagedV, ok := getIn(h, []string{"staged"}); ok {
			if staged, ok := stagedV.([]canonical.Value); ok {
				for _, d := range staged {
					ns, de := applyDeltaJSON(s, d) // commit
					if de != nil {
						return nil, de
					}
					s = ns
				}
			}
		}
		if refund.Sign() > 0 {
			nb := new(big.Int).Add(u256At(s, []string{"ptra", "balances", agent}), refund)
			if nb.Cmp(uint256Max) > 0 {
				return nil, aerr("OVERFLOW")
			}
			s = setIn(s, []string{"ptra", "balances", agent}, intVal(nb))
		}
		retained := new(big.Int).Sub(new(big.Int).Add(fee, gas), refund)
		if retained.Sign() < 0 {
			return nil, aerr("UNDERFLOW")
		}
		ns, fe := addFees(s, retained)
		if fe != nil {
			return nil, fe
		}
		s = bumpNonce(ns, agent)
		return deleteIn(s, []string{"cal", "in_flight", ch}), nil

	case "cal.failed", "cal.expired":
		ch, e := evStr(ev, "cal_hash")
		if e != nil {
			return nil, e
		}
		h, ok := getIn(state, []string{"cal", "in_flight", ch})
		if !ok {
			return nil, aerr("UNKNOWN_CAL")
		}
		agentV, _ := getIn(h, []string{"agent_id"})
		agent, _ := agentV.(string)
		fee := u256At(state, []string{"cal", "in_flight", ch, "fee_debited_ptra"})
		gas := u256At(state, []string{"cal", "in_flight", ch, "gas_consumed_ptra"})
		ns, fe := addFees(state, new(big.Int).Add(fee, gas))
		if fe != nil {
			return nil, fe
		}
		s := bumpNonce(ns, agent)
		return deleteIn(s, []string{"cal", "in_flight", ch}), nil

	case "ptra.transferred":
		from, e := evStr(ev, "from")
		if e != nil {
			return nil, e
		}
		to, e := evStr(ev, "to")
		if e != nil {
			return nil, e
		}
		amount, e := evUint(ev, "amount_nano_ptra")
		if e != nil {
			return nil, e
		}
		nbFrom := new(big.Int).Sub(u256At(state, []string{"ptra", "balances", from}), amount)
		if nbFrom.Sign() < 0 {
			return nil, aerr("INSUFFICIENT_BALANCE")
		}
		s := setIn(state, []string{"ptra", "balances", from}, intVal(nbFrom))
		nbTo := new(big.Int).Add(u256At(s, []string{"ptra", "balances", to}), amount)
		if nbTo.Cmp(uint256Max) > 0 {
			return nil, aerr("OVERFLOW")
		}
		return setIn(s, []string{"ptra", "balances", to}, intVal(nbTo)), nil

	case "ptra.shadow_init":
		addr, e := evStr(ev, "addr")
		if e != nil {
			return nil, e
		}
		if _, ok := getIn(state, []string{"ptra", "balances", addr}); ok {
			return state, nil
		}
		return setIn(state, []string{"ptra", "balances", addr}, canonical.IntU(0)), nil

	case "oracle.feed_submitted":
		symbol, e := evStr(ev, "symbol")
		if e != nil {
			return nil, e
		}
		val, _ := getIn(ev, []string{"value"})
		return setIn(state, []string{"oracles", "feeds", symbol}, val), nil

	case "tick.advanced":
		next, e := evUint(ev, "new_tick")
		if e != nil {
			return nil, e
		}
		curV, ok := getIn(state, []string{"tick", "current"})
		if !ok {
			return nil, aerr("BAD_TICK")
		}
		cur, ok := asU256(curV)
		if !ok || next.Cmp(cur) <= 0 {
			return nil, aerr("BAD_TICK")
		}
		s := setIn(state, []string{"tick", "current"}, intVal(next))
		return recomputeBounded(s), nil

	default:
		return nil, aerr("UNKNOWN_EVENT")
	}
}
