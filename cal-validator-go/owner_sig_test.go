// Integration test for the node-side owner-signature wiring (owner_sig.go). Contract digest/
// verdict parity is proven in tc-v2-verify-go; here we confirm the CAL-binding layer routes the
// two channels correctly: owner_sig via Contract A (real wallet capture verifies), operator_sig
// as a RAW Ed25519 verify (a wallet Contract A signature must NOT pass it — channels differ).

package calvalidator

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOwnerVsOperatorChannelsAreDistinct(t *testing.T) {
	path := filepath.Join("..", "spec", "vectors", "tc_v2_sig_verify_v1", "positive", "mytonwallet-binary.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var v struct {
		OperatorPubkey string `json:"operator_pubkey_hex"`
		SignatureB64   string `json:"signature_b64"`
		Input          struct {
			Workchain   int32  `json:"workchain"`
			AddressHash string `json:"address_hash_hex"`
			Domain      string `json:"domain"`
			Timestamp   uint64 `json:"timestamp"`
			PayloadB64  string `json:"payload_b64"`
		} `json:"input"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("parse: %v", err)
	}

	// owner_sig: Contract A reconstruction verifies (real wallet signData/binary).
	env := OwnerCoSignature{
		CalCanonicalBytesB64: v.Input.PayloadB64, // capture payload stands in for CAL canonical bytes
		Workchain:            v.Input.Workchain,
		AddressHashHex:       v.Input.AddressHash,
		Domain:               v.Input.Domain,
		Timestamp:            v.Input.Timestamp,
		SignatureB64:         v.SignatureB64,
	}
	if !OwnerSigPresent(env, v.OperatorPubkey) {
		t.Error("expected OwnerSigPresent=true via Contract A")
	}
	if OwnerSigPresent(env, "") {
		t.Error("empty owner pubkey → false")
	}

	// operator_sig: RAW Ed25519 over canonical bytes. A Contract A wallet signature is NOT a raw
	// signature over the payload bytes, so the raw path MUST reject it.
	canonicalBytes, _ := base64.StdEncoding.DecodeString(v.Input.PayloadB64)
	if OperatorSigPresent(canonicalBytes, v.SignatureB64, v.OperatorPubkey) {
		t.Error("a Contract A wallet signature must NOT pass the raw operator path")
	}
	if OperatorSigPresent(canonicalBytes, v.SignatureB64, "") {
		t.Error("empty operator pubkey → false")
	}
}
