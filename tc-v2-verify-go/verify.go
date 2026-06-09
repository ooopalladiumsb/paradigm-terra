package tcv2verify

import "crypto/ed25519"

// Two explicit, named entry points — one per contract. There is intentionally NO
// VerifyTonConnect(...) facade that switches internally by type
// (docs/spec/tc-v2-contract-boundaries.md). Go's std crypto/ed25519 is the second
// independent verification oracle after TS (Node crypto).

// VerifySignData verifies a Contract A owner signature.
func VerifySignData(in SignDataInput, signature, operatorPubkey []byte) bool {
	d := SignDataDigest(in)
	return ed25519.Verify(ed25519.PublicKey(operatorPubkey), d[:], signature)
}

// VerifyTonProof verifies a Contract B ton_proof.
func VerifyTonProof(in TonProofInput, signature, operatorPubkey []byte) bool {
	d := TonProofDigest(in)
	return ed25519.Verify(ed25519.PublicKey(operatorPubkey), d[:], signature)
}
