// Node-side owner-signature verifier — the real Ed25519 curve arithmetic the validator's
// ExecutionTrace OperatorSigPresent/OwnerSigPresent booleans depend on (trace.go notes this
// was deferred "so wiring is in place once curve arithmetic lands"; it lands here). validate()
// stays a pure function over the resulting booleans; this runs BEFORE the trace is built and
// is never called from inside validate().
//
// The two contracts (TC_V2_SIGNDATA_VERIFY_V1 / TC_V2_TONPROOF_VERIFY_V1) live in the shared,
// vector-pinned tc-v2-verify-go package — single Go source, no re-implementation, no shared
// serializer across the two (docs/spec/tc-v2-contract-boundaries.md). This file only adds the
// CAL co-signature → boolean wiring (§8.1/§8.2).

package calvalidator

import (
	"encoding/base64"
	"encoding/hex"

	tcv2 "github.com/paradigm-terra/tc-v2-verify-go"
)

const ed25519PublicKeySize = 32

// CalCoSignature is the ingress envelope around a CAL co-signature. Per §8.3 the signer
// co-signs canonical_bytes(cal_without_signatures) via signData/binary (Contract A); the
// wallet echoes address/domain/timestamp top-level (the D1 finding) so the node can rebuild
// the commit. CalCanonicalBytesB64 = base64(canonical_bytes(cal_without_signatures)).
type CalCoSignature struct {
	CalCanonicalBytesB64 string
	Workchain            int32
	AddressHashHex       string
	Domain               string
	Timestamp            uint64
	SignatureB64         string
}

func verifyCalCoSignature(env CalCoSignature, signerPubkeyHex string) bool {
	if signerPubkeyHex == "" {
		return false
	}
	pub, err := hex.DecodeString(signerPubkeyHex)
	if err != nil || len(pub) != ed25519PublicKeySize {
		return false
	}
	sig, err := base64.StdEncoding.DecodeString(env.SignatureB64)
	if err != nil {
		return false
	}
	ah, err := hex.DecodeString(env.AddressHashHex)
	if err != nil || len(ah) != 32 {
		return false
	}
	var addr [32]byte
	copy(addr[:], ah)

	in := tcv2.SignDataInput{
		Workchain:   env.Workchain,
		AddressHash: addr,
		Domain:      env.Domain,
		Timestamp:   env.Timestamp,
		PayloadType: "binary",
		PayloadB64:  env.CalCanonicalBytesB64,
	}
	return tcv2.VerifySignData(in, sig, pub)
}

// OperatorSigPresent computes ExecutionTrace.OperatorSigPresent from the operator co-signature
// envelope and the registry operator_pubkey. False on any failure (missing key / bad sig),
// which validate() turns into a §9.4 CAPABILITY_DENIED spam-charge.
func OperatorSigPresent(env CalCoSignature, operatorPubkeyHex string) bool {
	return verifyCalCoSignature(env, operatorPubkeyHex)
}

// OwnerSigPresent computes ExecutionTrace.OwnerSigPresent from the owner co-signature envelope
// and the registry owner_pubkey (§8.2; required for OWNER_REQUIRED_ACTIONS and Bounded Mode §10.4).
func OwnerSigPresent(env CalCoSignature, ownerPubkeyHex string) bool {
	return verifyCalCoSignature(env, ownerPubkeyHex)
}
