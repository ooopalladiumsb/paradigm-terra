package cal

import (
	"fmt"
	"strconv"
	"strings"

	canonical "github.com/paradigm-terra/canonical-go"
	dsl "github.com/paradigm-terra/dsl-go"
)

const CalVersion = "0.1.0"

var topLevelKeys = []string{
	"cal_version", "action", "agent_id", "nonce", "expiration_tick", "preconditions", "invariants",
	"steps", "receipt_required", "signatures", "compatibility_pragma", "gas_limit_ptra",
}
var requiredFields = []string{
	"cal_version", "action", "agent_id", "nonce", "expiration_tick", "preconditions", "invariants",
	"steps", "receipt_required", "signatures",
}
var stepKeys = []string{"verb", "params", "post_conditions"}
var sigKeys = []string{"operator_sig", "owner_sig", "sponsor_sig"}
var ownerEnvelopeKeys = []string{"signature", "domain", "timestamp", "workchain", "address_hash"}

func objOf(v canonical.Value) (*canonical.Object, bool) {
	o, ok := v.(*canonical.Object)
	return o, ok
}

func getField(cal canonical.Value, key string) (canonical.Value, bool) {
	if o, ok := cal.(*canonical.Object); ok {
		return o.Get(key)
	}
	return nil, false
}

func asStr(cal canonical.Value, key string) (string, bool) {
	if v, ok := getField(cal, key); ok {
		s, ok := v.(string)
		return s, ok
	}
	return "", false
}

func contains(xs []string, x string) bool {
	for _, e := range xs {
		if e == x {
			return true
		}
	}
	return false
}

func checkUnexpected(o *canonical.Object, allowed []string, code string) *calErr {
	for _, k := range o.Keys() {
		if !contains(allowed, k) {
			return cerrD(code, k)
		}
	}
	return nil
}

func isU64(v canonical.Value, ok bool) bool {
	if !ok {
		return false
	}
	iv, isInt := v.(canonical.Int)
	if !isInt {
		return false
	}
	_, err := strconv.ParseUint(string(iv), 10, 64)
	return err == nil
}

func isNonnegInt(v canonical.Value, ok bool) bool {
	if !ok {
		return false
	}
	iv, isInt := v.(canonical.Int)
	return isInt && !strings.HasPrefix(string(iv), "-")
}

func isHexBytes(s string) bool {
	if !strings.HasPrefix(s, "0x") || (len(s)-2)%2 != 0 {
		return false
	}
	for i := 2; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func namespaceOf(action string) string {
	if i := strings.IndexByte(action, '.'); i >= 0 {
		return action[:i]
	}
	return action
}

func validateEmbedded(node canonical.Value, scope dsl.Scope, where string) *calErr {
	version := dsl.V12
	expr := node
	if o, ok := node.(*canonical.Object); ok {
		if _, has := o.Get("dsl_version"); has {
			if vv, ok := o.Get("dsl_version"); ok {
				if vs, ok := vv.(string); ok {
					if ver, ok := dsl.VersionFromString(vs); ok {
						version = ver
					}
				}
			}
			if e, ok := o.Get("expr"); ok {
				expr = e
			}
		}
	}
	if _, err := dsl.ParseExpression(expr, scope, version); err != nil {
		return cerrD("DSL_INVALID", fmt.Sprintf("%s: %s/%s", where, err.Phase.Code(), err.Reason))
	}
	return nil
}

func validateSignatures(sig canonical.Value) *calErr {
	o, ok := objOf(sig)
	if !ok {
		return cerr("BAD_SIGNATURES")
	}
	if e := checkUnexpected(o, sigKeys, "UNEXPECTED_SIG_FIELD"); e != nil {
		return e
	}
	if _, ok := o.Get("operator_sig"); !ok {
		return cerrD("MISSING_FIELD", "signatures.operator_sig")
	}
	// operator_sig / sponsor_sig: raw hex Ed25519 bytes.
	for _, k := range []string{"operator_sig", "sponsor_sig"} {
		if v, ok := o.Get(k); ok {
			s, isStr := v.(string)
			if !isStr || !isHexBytes(s) {
				return cerrD("BAD_SIG_BYTES", "signatures."+k)
			}
		}
	}
	// owner_sig: legacy hex string OR the Contract A reconstruction envelope object
	// (dual-accept, §8.4 Tier-2 window; D-S1/D-S2).
	if v, ok := o.Get("owner_sig"); ok {
		if s, isStr := v.(string); isStr {
			if !isHexBytes(s) {
				return cerrD("BAD_SIG_BYTES", "signatures.owner_sig")
			}
		} else {
			env, isObj := objOf(v)
			if !isObj {
				return cerrD("BAD_OWNER_ENVELOPE", "signatures.owner_sig")
			}
			if e := checkUnexpected(env, ownerEnvelopeKeys, "UNEXPECTED_OWNER_ENVELOPE_FIELD"); e != nil {
				return e
			}
			for _, k := range ownerEnvelopeKeys {
				if _, ok := env.Get(k); !ok {
					return cerrD("MISSING_FIELD", "signatures.owner_sig."+k)
				}
			}
			sv, _ := env.Get("signature")
			if s, isStr := sv.(string); !isStr || !isHexBytes(s) {
				return cerrD("BAD_SIG_BYTES", "signatures.owner_sig.signature")
			}
			// address_hash: 0x + exactly 32 bytes (reconstruction primitive, not friendly form).
			av, _ := env.Get("address_hash")
			if s, isStr := av.(string); !isStr || !isHexBytes(s) || len(s) != 66 {
				return cerrD("BAD_OWNER_ENVELOPE", "signatures.owner_sig.address_hash")
			}
			dv, _ := env.Get("domain")
			if s, isStr := dv.(string); !isStr || s == "" {
				return cerrD("BAD_OWNER_ENVELOPE", "signatures.owner_sig.domain")
			}
			if tv, ok := env.Get("timestamp"); !isU64(tv, ok) {
				return cerrD("BAD_OWNER_ENVELOPE", "signatures.owner_sig.timestamp")
			}
			if wv, ok := env.Get("workchain"); !isInt32(wv, ok) {
				return cerrD("BAD_OWNER_ENVELOPE", "signatures.owner_sig.workchain")
			}
		}
	}
	return nil
}

func isInt32(v canonical.Value, ok bool) bool {
	if !ok {
		return false
	}
	iv, isInt := v.(canonical.Int)
	if !isInt {
		return false
	}
	n, err := strconv.ParseInt(string(iv), 10, 64)
	return err == nil && n >= -(1<<31) && n <= (1<<31)-1
}

func validateStep(step canonical.Value, namespace, where string) *calErr {
	o, ok := objOf(step)
	if !ok {
		return cerr("BAD_STEP")
	}
	if e := checkUnexpected(o, stepKeys, "UNEXPECTED_STEP_FIELD"); e != nil {
		return e
	}
	verb, ok := asStr(step, "verb")
	if !ok {
		return cerrD("BAD_STEP", where+".verb")
	}
	if !dsl.IsRegisteredAction(verb) {
		return cerrD("UNKNOWN_VERB", verb)
	}
	if namespaceOf(verb) != namespace {
		return cerrD("VERB_NAMESPACE_MISMATCH", fmt.Sprintf("%s not in %s.*", verb, namespace))
	}
	params, ok := o.Get("params")
	if !ok {
		return cerr("BAD_PARAMS")
	}
	if _, ok := objOf(params); !ok {
		return cerr("BAD_PARAMS")
	}
	if pcs, ok := o.Get("post_conditions"); ok {
		arr, ok := pcs.([]canonical.Value)
		if !ok {
			return cerrD("POSTCONDITIONS_NOT_LIST", where)
		}
		for i, pc := range arr {
			if e := validateEmbedded(pc, dsl.ScopePostCondition, fmt.Sprintf("%s.post_conditions[%d]", where, i)); e != nil {
				return e
			}
		}
	}
	return nil
}

func validate(cal canonical.Value) *calErr {
	o, ok := objOf(cal)
	if !ok {
		return cerr("NOT_OBJECT")
	}
	if e := checkUnexpected(o, topLevelKeys, "UNEXPECTED_FIELD"); e != nil {
		return e
	}
	for _, f := range requiredFields {
		if _, ok := o.Get(f); !ok {
			return cerrD("MISSING_FIELD", f)
		}
	}

	if cv, _ := asStr(cal, "cal_version"); cv != CalVersion {
		return cerrD("BAD_CAL_VERSION", cv)
	}

	action, _ := asStr(cal, "action")
	if !dsl.IsRegisteredAction(action) {
		return cerrD("UNKNOWN_ACTION", action)
	}
	namespace := namespaceOf(action)

	agentID, ok := asStr(cal, "agent_id")
	if !ok || !canonical.IsCanonicalAddress(agentID) {
		return cerr("BAD_AGENT_ID")
	}

	if nonce, ok := o.Get("nonce"); !isU64(nonce, ok) {
		return cerr("BAD_NONCE")
	}
	if exp, ok := o.Get("expiration_tick"); !isU64(exp, ok) {
		return cerr("BAD_EXPIRATION")
	}

	pre, _ := o.Get("preconditions")
	if e := validateEmbedded(pre, dsl.ScopePrecondition, "preconditions"); e != nil {
		return e
	}

	inv, _ := o.Get("invariants")
	invArr, ok := inv.([]canonical.Value)
	if !ok {
		return cerr("INVARIANTS_NOT_LIST")
	}
	for i, iv := range invArr {
		if e := validateEmbedded(iv, dsl.ScopeInvariant, fmt.Sprintf("invariants[%d]", i)); e != nil {
			return e
		}
	}

	steps, _ := o.Get("steps")
	stepArr, ok := steps.([]canonical.Value)
	if !ok {
		return cerr("STEPS_NOT_LIST")
	}
	if len(stepArr) == 0 {
		return cerr("EMPTY_STEPS")
	}
	for i, s := range stepArr {
		if e := validateStep(s, namespace, fmt.Sprintf("steps[%d]", i)); e != nil {
			return e
		}
	}

	if rr, ok := o.Get("receipt_required"); !ok {
		return cerr("BAD_RECEIPT_REQUIRED")
	} else if _, isBool := rr.(bool); !isBool {
		return cerr("BAD_RECEIPT_REQUIRED")
	}

	sig, _ := o.Get("signatures")
	if e := validateSignatures(sig); e != nil {
		return e
	}

	if p, ok := o.Get("compatibility_pragma"); ok {
		if s, _ := p.(string); s != "v0.9.5" {
			return cerrD("BAD_PRAGMA", s)
		}
	}
	if g, ok := o.Get("gas_limit_ptra"); ok && !isNonnegInt(g, true) {
		return cerr("BAD_GAS_LIMIT")
	}

	return nil
}

// CheckCal validates a CAL blob, returning a stable {Valid, Code, Detail} result.
func CheckCal(cal canonical.Value) CheckResult {
	if e := validate(cal); e != nil {
		return CheckResult{Valid: false, Code: e.code, Detail: e.detail}
	}
	return CheckResult{Valid: true}
}
