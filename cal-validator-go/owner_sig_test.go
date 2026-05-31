// Integration test for the node-side owner-signature wiring (owner_sig.go). The contract
// digest/verdict parity itself is proven in tc-v2-verify-go; here we confirm the CAL
// co-signature envelope produces the right trace boolean against a REAL signData/binary
// signature (treating the captured payload bytes as the CAL canonical bytes).

package calvalidator

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOperatorSigPresentAgainstRealCapture(t *testing.T) {
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

	env := CalCoSignature{
		CalCanonicalBytesB64: v.Input.PayloadB64, // capture payload stands in for CAL canonical bytes
		Workchain:            v.Input.Workchain,
		AddressHashHex:       v.Input.AddressHash,
		Domain:               v.Input.Domain,
		Timestamp:            v.Input.Timestamp,
		SignatureB64:         v.SignatureB64,
	}

	if !OperatorSigPresent(env, v.OperatorPubkey) {
		t.Error("expected OperatorSigPresent=true for a real signData/binary signature")
	}
	// tampered (but valid-length) pubkey must fail, not panic
	tampered := "00" + v.OperatorPubkey[2:]
	if OperatorSigPresent(env, tampered) {
		t.Error("expected false for tampered pubkey")
	}
	// empty pubkey must fail, not panic
	if OperatorSigPresent(env, "") {
		t.Error("expected false for empty pubkey")
	}
	// tampered timestamp must fail
	bad := env
	bad.Timestamp = env.Timestamp + 1
	if OperatorSigPresent(bad, v.OperatorPubkey) {
		t.Error("expected false for tampered timestamp")
	}
}
