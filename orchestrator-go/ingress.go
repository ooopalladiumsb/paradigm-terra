package orchestrator

// verifyIngress (Go) — the second Ed25519-capable node verifier (after TS), deriving the trace
// signature-presence booleans from consensus-visible CAL signature material. Mirrors
// orchestrator/src/ingress.ts. operator_sig = raw Ed25519 over canonical_bytes(cal_without_signatures);
// owner_sig = Contract A commit from the envelope object. D-S4: no backfill (legacy/absent owner
// envelope → OwnerSigPresent=false). The Rust node is deferred-by-constraint (no Ed25519).

import (
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"

	calgo "github.com/paradigm-terra/cal-go"
	calvalidator "github.com/paradigm-terra/cal-validator-go"
	canonical "github.com/paradigm-terra/canonical-go"
)

func strip0x(h string) string { return strings.TrimPrefix(h, "0x") }

func hexToB64(h string) string {
	b, err := hex.DecodeString(strip0x(h))
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(b)
}

// IngressVerdict carries the derived trace booleans.
type IngressVerdict struct {
	OperatorSigPresent bool
	OwnerSigPresent    bool
}

// VerifyIngress derives OperatorSigPresent/OwnerSigPresent from the CAL's signatures and the
// registry pubkeys (both "0x"-hex). Reconstruction is exclusively from CAL-carried fields.
func VerifyIngress(cal canonical.Value, operatorPubkeyHex, ownerPubkeyHex string) IngressVerdict {
	out := IngressVerdict{}
	canonicalBytes, err := calgo.CanonicalUnsignedBytes(cal)
	if err != nil {
		return out
	}
	o, ok := cal.(*canonical.Object)
	if !ok {
		return out
	}
	sigsV, ok := o.Get("signatures")
	if !ok {
		return out
	}
	sigs, ok := sigsV.(*canonical.Object)
	if !ok {
		return out
	}

	// operator_sig — raw Ed25519
	if opPub := strip0x(operatorPubkeyHex); opPub != "" {
		if sv, ok := sigs.Get("operator_sig"); ok {
			if s, isStr := sv.(string); isStr {
				out.OperatorSigPresent = calvalidator.OperatorSigPresent(canonicalBytes, hexToB64(s), opPub)
			}
		}
	}

	// owner_sig — Contract A, ONLY from the envelope object (no backfill, D-S4)
	if ownerPub := strip0x(ownerPubkeyHex); ownerPub != "" {
		if ov, ok := sigs.Get("owner_sig"); ok {
			if env, isObj := ov.(*canonical.Object); isObj {
				str := func(k string) string {
					v, _ := env.Get(k)
					s, _ := v.(string)
					return s
				}
				tsV, _ := env.Get("timestamp")
				wcV, _ := env.Get("workchain")
				tsInt, okTs := tsV.(canonical.Int)
				wcInt, okWc := wcV.(canonical.Int)
				if okTs && okWc {
					ts, e1 := strconv.ParseUint(string(tsInt), 10, 64)
					wc, e2 := strconv.ParseInt(string(wcInt), 10, 64)
					if e1 == nil && e2 == nil {
						env2 := calvalidator.OwnerCoSignature{
							CalCanonicalBytesB64: base64.StdEncoding.EncodeToString(canonicalBytes),
							Workchain:            int32(wc),
							AddressHashHex:       strip0x(str("address_hash")),
							Domain:               str("domain"),
							Timestamp:            ts,
							SignatureB64:         hexToB64(str("signature")),
						}
						out.OwnerSigPresent = calvalidator.OwnerSigPresent(env2, ownerPub)
					}
				}
			}
		}
	}
	return out
}
