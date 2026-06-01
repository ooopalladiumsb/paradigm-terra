// Node-side owner-signature verifier — the real Ed25519 curve arithmetic the validator's
// ExecutionTrace OperatorSigPresent/OwnerSigPresent booleans depend on (trace.go notes this
// was deferred "so wiring is in place once curve arithmetic lands"; it lands here). validate()
// stays a pure function over the resulting booleans; this runs BEFORE the trace is built and
// is never called from inside validate().
//
// TWO DISTINCT signature-origin chains — do NOT unify (cal-co-signature-envelope-draft.md):
//   operator_sig — RAW Ed25519 over canonical CAL bytes, produced by the AGENT RUNTIME with its
//                  local operator key (Exec Spec §8.1/§8.3: "no external ingress channel").
//                  No TON Connect, no Contract A, no envelope.
//   owner_sig    — TON Connect signData/binary, a Contract A commit by a human WALLET (D1), with
//                  the envelope (domain/timestamp/address/workchain). Contract A lives in the
//                  shared, vector-pinned tc-v2-verify-go package (no re-implementation).

package calvalidator

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"

	tcv2 "github.com/paradigm-terra/tc-v2-verify-go"
)

const ed25519PublicKeySize = 32

// OperatorSigPresent computes ExecutionTrace.OperatorSigPresent: a RAW Ed25519 verify of the
// agent's operator signature over canonical_bytes(cal_without_signatures). The operator key is
// held by the agent runtime and signs programmatically — no wallet, so this is NOT a Contract A
// commit. False on any failure → validate() turns it into §9.4 CAPABILITY_DENIED.
func OperatorSigPresent(calCanonicalBytes []byte, operatorSigB64, operatorPubkeyHex string) bool {
	if operatorPubkeyHex == "" {
		return false
	}
	pub, err := hex.DecodeString(operatorPubkeyHex)
	if err != nil || len(pub) != ed25519PublicKeySize {
		return false
	}
	sig, err := base64.StdEncoding.DecodeString(operatorSigB64)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pub), calCanonicalBytes, sig)
}

// OwnerCoSignature is the owner co-signature envelope. Per §8.3 the OWNER co-signs
// canonical_bytes(cal_without_signatures) via TON Connect signData/binary (Contract A); the
// wallet echoes address/domain/timestamp top-level (the D1 finding) so the node can rebuild the
// commit. CalCanonicalBytesB64 = base64(canonical_bytes(cal_without_signatures)).
// (operator_sig has NO envelope — see OperatorSigPresent.)
type OwnerCoSignature struct {
	CalCanonicalBytesB64 string
	Workchain            int32
	AddressHashHex       string
	Domain               string
	Timestamp            uint64
	SignatureB64         string
}

// OwnerSigPresent computes ExecutionTrace.OwnerSigPresent from the owner co-signature envelope
// and the registry owner_pubkey (§8.2; required for OWNER_REQUIRED_ACTIONS and Bounded Mode
// §10.4) via Contract A reconstruction.
func OwnerSigPresent(env OwnerCoSignature, ownerPubkeyHex string) bool {
	if ownerPubkeyHex == "" {
		return false
	}
	pub, err := hex.DecodeString(ownerPubkeyHex)
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
