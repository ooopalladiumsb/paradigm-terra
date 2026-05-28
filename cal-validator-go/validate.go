package calvalidator

import (
	"math/big"

	canonical "github.com/paradigm-terra/canonical-go"
	calgas "github.com/paradigm-terra/cal-gas-go"
	dsl "github.com/paradigm-terra/dsl-go"
)

// ValidationResult is the validator verdict: the ordered reducer-ready events,
// the terminal stage, the reason code (empty unless FAILED), an informational
// detail (not consensus-critical), and the intended §9.4 settlement.
type ValidationResult struct {
	Events        []canonical.Value
	TerminalStage string
	ReasonCode    string
	ReasonDetail  string
	Bill          *calgas.GasBill
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

func asStr(v canonical.Value) string {
	s, _ := v.(string)
	return s
}

func asBigField(v canonical.Value, ok bool) *big.Int {
	if !ok {
		return big.NewInt(0)
	}
	iv, isInt := v.(canonical.Int)
	if !isInt {
		return big.NewInt(0)
	}
	n, good := new(big.Int).SetString(string(iv), 10)
	if !good {
		return big.NewInt(0)
	}
	return n
}

func intVal(n *big.Int) canonical.Value { return canonical.Int(n.String()) }

func arrField(v canonical.Value, path []string) []canonical.Value {
	if x, ok := getIn(v, path); ok {
		if a, ok := x.([]canonical.Value); ok {
			return a
		}
	}
	return nil
}

func idPairs(calHash, agent string, nonce *big.Int) []canonical.Pair {
	return []canonical.Pair{canonical.P("cal_hash", calHash), canonical.P("agent_id", agent), canonical.P("nonce", intVal(nonce))}
}

// failedEvent builds a cal.failed event. feeDebited carries the §9.4 spam charge
// the reducer debits at a pre-VALIDATED failure (present even when zero); pass
// nil for post-VALIDATED (execFail) failures, where the fee was already escrowed
// at cal.validated. gasRefunded carries the unused-gas refund on a post-VALIDATED
// failure (§9.3); pass nil for pre-VALIDATED failures, which omit the field
// (matches TS/Rust byte-for-byte).
func failedEvent(calHash, agent string, nonce, tick *big.Int, reason string, feeDebited, gasConsumed, gasRefunded *big.Int) canonical.Value {
	p := idPairs(calHash, agent, nonce)
	p = append(p,
		canonical.P("event_type", "cal.failed"),
		canonical.P("tick_failed", intVal(tick)),
		canonical.P("reason_code", reason),
	)
	if feeDebited != nil {
		p = append(p, canonical.P("fee_debited_ptra", intVal(feeDebited)))
	}
	p = append(p, canonical.P("gas_consumed_ptra", intVal(gasConsumed)))
	if gasRefunded != nil {
		p = append(p, canonical.P("gas_refunded_ptra", intVal(gasRefunded)))
	}
	p = append(p, canonical.P("ton_ingress_fee_paid", intVal(big.NewInt(0))))
	return canonical.NewObject(p...)
}

// expiredEvent builds a cal.expired event. gasRefunded carries the unused-gas
// refund on a post-VALIDATED expiry (§9.3 = the full Max_Expected_Dynamic_Gas);
// pass nil for a pre-VALIDATED expiry, which omits the field.
func expiredEvent(calHash, agent string, nonce, tick, gasRefunded *big.Int) canonical.Value {
	p := idPairs(calHash, agent, nonce)
	p = append(p,
		canonical.P("event_type", "cal.expired"),
		canonical.P("tick_expired", intVal(tick)),
		canonical.P("gas_consumed_ptra", intVal(big.NewInt(0))),
	)
	if gasRefunded != nil {
		p = append(p, canonical.P("gas_refunded_ptra", intVal(gasRefunded)))
	}
	p = append(p, canonical.P("ton_ingress_fee_paid", intVal(big.NewInt(0))))
	return canonical.NewObject(p...)
}

// evalExpr evaluates an embedded expression; a {dsl_version, expr} envelope
// overrides the default v1.2. `bindings` is a JcsValue object keyed by root.
func evalExpr(node canonical.Value, present bool, scope dsl.Scope, bindings canonical.Value) dsl.Outcome {
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
					return dsl.Outcome{Code: "VALIDATION_ERROR", Reason: "UNSUPPORTED_VERSION"}
				}
				e, has2 := o.Get("expr")
				expr, exprPresent = e, has2
			}
		}
	}
	if !exprPresent {
		return dsl.Outcome{Code: "PARSE_ERROR", Reason: "MALFORMED_NODE"}
	}
	return dsl.Run(expr, scope, version, dsl.BindingsFromJcs(bindings))
}

func capabilityGrants(snapshot canonical.Value, agent, action string) bool {
	required := dsl.RequiredScopes(action)
	if len(required) == 0 {
		return true
	}
	granted := map[string]bool{}
	if g, ok := getIn(snapshot, []string{"registry", "agents", agent, "granted_scopes"}); ok {
		if arr, ok := g.([]canonical.Value); ok {
			for _, x := range arr {
				if s, ok := x.(string); ok {
					granted[s] = true
					for _, implied := range dsl.ImpliedScopes(s) {
						granted[implied] = true
					}
				}
			}
		}
	}
	for _, s := range required {
		if !granted[s] {
			return false
		}
	}
	return true
}

// Validate runs the §3.1 lifecycle pipeline. `calHash` is opaque (echoed into
// every event's cal_hash). Returns a GasError (as error) only on a gas/canonical
// fault, which valid inputs never hit.
func Validate(cal canonical.Value, calHash string, snapshot canonical.Value, trace ExecutionTrace) (*ValidationResult, error) {
	agent := asStr(mustGet(cal, "agent_id"))
	action := asStr(mustGet(cal, "action"))
	nonceV, nOk := getIn(cal, []string{"nonce"})
	nonce := asBigField(nonceV, nOk)
	expV, eOk := getIn(cal, []string{"expiration_tick"})
	expiration := asBigField(expV, eOk)
	tick := trace.CurrentTick
	fee := calgas.FlatValidationFee(snapshot)

	var events []canonical.Value
	mk := func(stage, reason, detail string, bill *calgas.GasBill) *ValidationResult {
		return &ValidationResult{Events: events, TerminalStage: stage, ReasonCode: reason, ReasonDetail: detail, Bill: bill}
	}

	// preFail: pre-VALIDATED FAILED (no cal.validated). The event carries
	// fee_debited_ptra (= bill.FeeRetained), which the reducer debits at
	// cal.failed (Tier-2 revision). FailedPrecond → §9.4 spam charge
	// min(fee, balance); FailedNoCharge → §9.1 ingress-class, zero. events == bill.
	preFail := func(reason, detail string, outcome calgas.Outcome) (*ValidationResult, error) {
		bill, ge := calgas.Settle(outcome, cal, snapshot, big.NewInt(0))
		if ge != nil {
			return nil, ge
		}
		events = append(events, failedEvent(calHash, agent, nonce, tick, reason, bill.FeeRetained, big.NewInt(0), nil))
		return mk("FAILED", reason, detail, bill), nil
	}
	execFail := func(reason, detail string, committed []canonical.Value) (*ValidationResult, error) {
		bw, err := calgas.EffectsBytes(committed)
		if err != nil {
			return nil, err
		}
		bill, ge := calgas.Settle(calgas.FailedExec, cal, snapshot, bw)
		if ge != nil {
			return nil, ge
		}
		// post-VALIDATED: fee already escrowed; omit fee_debited_ptra (nil).
		events = append(events, failedEvent(calHash, agent, nonce, tick, reason, nil, bill.DynamicGasConsumed, bill.GasRefunded))
		return mk("FAILED", reason, detail, bill), nil
	}

	// 1. action registered (§2.3) — malformed, §9.1 ingress-class, no charge
	if !dsl.IsRegisteredAction(action) {
		return preFail("UNKNOWN_ACTION", "action not in §2.3 registry", calgas.FailedNoCharge)
	}

	// 1.25. §4.4 MCP schema-hash pin: when the validator has configured a non-empty
	//       pinned hash, it MUST equal state.registry.mcp_schema_hash. System-level
	//       fault → no-charge (ingress-class). The node-level MCP_DEGRADED_MODE
	//       transition (Constitution §VI) sits outside this pure function.
	if trace.PinnedMCPSchemaHash != "" {
		stateSchemaV, _ := getIn(snapshot, []string{"registry", "mcp_schema_hash"})
		stateSchema := asStr(stateSchemaV)
		if stateSchema != trace.PinnedMCPSchemaHash {
			return preFail("SCHEMA_MISMATCH", "pinned mcp_schema_hash != state", calgas.FailedNoCharge)
		}
	}

	// 1.5. §10.2 Bounded-Mode admission gate — no-charge (ingress-class).
	boundedV, _ := getIn(snapshot, []string{"failure_mode", "is_bounded_mode"})
	boundedMode := false
	if b, ok := boundedV.(bool); ok && b {
		boundedMode = true
	}
	if boundedMode && !dsl.IsBoundedAllowed(action) {
		return preFail("BOUNDED_BLOCKED", "action not in §10.2 Bounded-Mode whitelist", calgas.FailedNoCharge)
	}

	// 2. expiration before VALIDATED (§3.4)
	if tick.Cmp(expiration) > 0 {
		bill, ge := calgas.Settle(calgas.ExpiredPre, cal, snapshot, big.NewInt(0))
		if ge != nil {
			return nil, ge
		}
		events = append(events, expiredEvent(calHash, agent, nonce, tick, nil))
		return mk("EXPIRED", "", "expired before VALIDATED", bill), nil
	}

	// 3. nonce (§6.2)
	snapNonceV, snOk := getIn(snapshot, []string{"cal", "nonces", agent})
	expected := new(big.Int).Add(asBigField(snapNonceV, snOk), big.NewInt(1))
	if nonce.Cmp(expected) != 0 {
		// malformed/replay, §9.1 ingress-class, no charge
		return preFail("NONCE_MISMATCH", "nonce mismatch", calgas.FailedNoCharge)
	}

	// 4. signature presence + pubkey availability (§8.1 two key tiers, §8.2).
	//    operator_sig is always required; owner_sig is required for
	//    OWNER_REQUIRED_ACTIONS and (§10.4) for every action in Bounded Mode.
	//    Real Ed25519 curve verification is deferred: the trace's *SigPresent
	//    flags carry the node's verifier verdict, and registry pubkeys are
	//    looked up here so wiring is in place once curve arithmetic lands.
	//    Each branch is §9.4 spam-charge (CAPABILITY_DENIED).
	if !trace.OperatorSigPresent {
		return preFail("CAPABILITY_DENIED", "operator_sig required", calgas.FailedPrecond)
	}
	operatorPubkeyV, _ := getIn(snapshot, []string{"registry", "agents", agent, "operator_pubkey"})
	if asStr(operatorPubkeyV) == "" {
		return preFail("CAPABILITY_DENIED", "agent has no operator_pubkey in registry", calgas.FailedPrecond)
	}
	ownerRequired := dsl.IsOwnerRequired(action) || boundedMode
	if ownerRequired {
		if !trace.OwnerSigPresent {
			return preFail("CAPABILITY_DENIED", "owner_sig required", calgas.FailedPrecond)
		}
		ownerPubkeyV, _ := getIn(snapshot, []string{"registry", "agents", agent, "owner_pubkey"})
		if asStr(ownerPubkeyV) == "" {
			return preFail("CAPABILITY_DENIED", "agent has no owner_pubkey in registry", calgas.FailedPrecond)
		}
	}

	// 5. scope grant (§4.3) — §9.4 spam charge
	if !capabilityGrants(snapshot, agent, action) {
		return preFail("CAPABILITY_DENIED", "agent lacks required scope", calgas.FailedPrecond)
	}

	// 6. preconditions — PRECOND_FALSE retains the §9.4 fee; PRECOND_ERROR is ingress-class, no charge
	preNode, preOk := getIn(cal, []string{"preconditions"})
	pre := evalExpr(preNode, preOk, dsl.ScopePrecondition, canonical.NewObject(canonical.P("state", snapshot)))
	if pre.Code != "EVALUATION_TRUE" {
		reason, outcome := "PRECOND_ERROR", calgas.FailedNoCharge
		if pre.Code == "EVALUATION_FALSE" {
			reason, outcome = "PRECOND_FALSE", calgas.FailedPrecond
		}
		return preFail(reason, "preconditions not satisfied", outcome)
	}

	// 7. escrow gate (§9.3) — agent cannot cover escrow, no PTRA can be taken.
	//    §3.5: dedicated INSUFFICIENT_ESCROW, distinct from the gate-11 OUT_OF_GAS overrun.
	if !calgas.CanValidate(cal, snapshot) {
		return preFail("INSUFFICIENT_ESCROW", "balance < escrow (§9.3)", calgas.FailedNoCharge)
	}

	// --- cal.validated: §9.3 upfront deposit — escrow = fee + Max_Expected_Dynamic_Gas.
	// The reducer debits the full escrow; the unused gas is refunded at the terminal
	// event (gas_refunded_ptra) and the treasury keeps escrow − refund.
	maxGas := calgas.MaxExpectedDynamicGas(cal, fee)
	{
		p := idPairs(calHash, agent, nonce)
		p = append(p, canonical.P("event_type", "cal.validated"), canonical.P("escrow_ptra", intVal(new(big.Int).Add(fee, maxGas))))
		events = append(events, canonical.NewObject(p...))
	}

	// 8. expiration recheck (defensive; constant tick → never fires here)
	if tick.Cmp(expiration) > 0 {
		bill, ge := calgas.Settle(calgas.ExpiredPost, cal, snapshot, big.NewInt(0))
		if ge != nil {
			return nil, ge
		}
		events = append(events, expiredEvent(calHash, agent, nonce, tick, bill.GasRefunded))
		return mk("EXPIRED", "", "expired after VALIDATED", bill), nil
	}

	// 9–10. steps
	steps := arrField(cal, []string{"steps"})
	var committed []canonical.Value
	for i, st := range steps {
		if i >= len(trace.Steps) || !trace.Steps[i].OK {
			detail := "step failed"
			if i < len(trace.Steps) && trace.Steps[i].ErrorDetail != "" {
				detail = trace.Steps[i].ErrorDetail
			}
			return execFail("STEP_ERROR", detail, committed)
		}
		committed = append(committed, trace.Steps[i].Effects...)
		paramsV, _ := getIn(st, []string{"params"})
		for _, pc := range arrField(st, []string{"post_conditions"}) {
			b := canonical.NewObject(canonical.P("before", trace.StateBefore), canonical.P("after", trace.StateAfter), canonical.P("params", paramsV))
			o := evalExpr(pc, true, dsl.ScopePostCondition, b)
			if o.Code != "EVALUATION_TRUE" {
				reason := "STEP_ERROR"
				if o.Code == "EVALUATION_FALSE" {
					reason = "POSTCOND_FALSE"
				}
				return execFail(reason, "post_condition not satisfied", committed)
			}
		}
	}

	// 11. dynamic gas vs budget (§9.3)
	bytesWritten, err := calgas.EffectsBytes(committed)
	if err != nil {
		return nil, err
	}
	gu, ge := calgas.GasUnits(cal, bytesWritten)
	if ge != nil {
		return nil, ge
	}
	rawGas := calgas.ToNano(gu, calgas.GasPrice(snapshot))
	if rawGas.Cmp(maxGas) > 0 {
		return execFail("OUT_OF_GAS", "dynamic gas exceeds budget", committed)
	}
	consumed := rawGas

	// --- cal.executed ---
	{
		p := idPairs(calHash, agent, nonce)
		p = append(p, canonical.P("event_type", "cal.executed"), canonical.P("effects", committed), canonical.P("gas_consumed_ptra", intVal(consumed)))
		events = append(events, canonical.NewObject(p...))
	}

	// 12. expiration recheck (defensive)
	if tick.Cmp(expiration) > 0 {
		bill, ge := calgas.Settle(calgas.ExpiredPost, cal, snapshot, big.NewInt(0))
		if ge != nil {
			return nil, ge
		}
		events = append(events, expiredEvent(calHash, agent, nonce, tick, bill.GasRefunded))
		return mk("EXPIRED", "", "expired after VALIDATED", bill), nil
	}

	// 13. invariants — Bounded Mode appends the DSL §7.1 / CAL §10.3 emergency set.
	declared := arrField(cal, []string{"invariants"})
	invs := dsl.EffectiveInvariants(declared, boundedMode)
	for _, inv := range invs {
		b := canonical.NewObject(canonical.P("before", trace.StateBefore), canonical.P("after", trace.StateAfter))
		o := evalExpr(inv, true, dsl.ScopeInvariant, b)
		if o.Code != "EVALUATION_TRUE" {
			return execFail("INVARIANT_FALSE", "invariant not satisfied", committed)
		}
	}

	// --- cal.settled + cal.finalized ---
	events = append(events, canonical.NewObject(canonical.P("event_type", "cal.settled"), canonical.P("cal_hash", calHash)))
	bill, ge := calgas.Settle(calgas.Finalized, cal, snapshot, bytesWritten)
	if ge != nil {
		return nil, ge
	}
	{
		p := idPairs(calHash, agent, nonce)
		p = append(p,
			canonical.P("event_type", "cal.finalized"),
			canonical.P("tick_finalized", intVal(tick)),
			canonical.P("gas_consumed_ptra", intVal(consumed)),
			canonical.P("gas_refunded_ptra", intVal(bill.GasRefunded)),
			canonical.P("steps_applied", intVal(big.NewInt(int64(len(steps))))),
			canonical.P("invariants_checked", intVal(big.NewInt(int64(len(invs))))),
		)
		events = append(events, canonical.NewObject(p...))
	}
	return mk("FINALIZED", "", "", bill), nil
}

func mustGet(v canonical.Value, key string) canonical.Value {
	cv, _ := getIn(v, []string{key})
	return cv
}
