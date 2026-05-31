// Parity against the TypeScript reference golden vectors
// (../spec/vectors/tc_v2_sig_verify_v1/). Go exercises BOTH axes:
//
//   digest  — recompute the contract digest from input (digest_from_input vectors)
//             and assert byte-equality with the committed digest_sha256_hex.
//   verdict — ed25519_verify(digest, signature, pubkey) == expected verdict, using Go's
//             own digest for digest_from_input vectors (full independent chain) and the
//             committed override digest for construction-override negatives.
//
// Go is the second independent Ed25519 oracle (std crypto/ed25519) after TS (Node crypto).
package tcv2verify

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const pkgDir = "../spec/vectors/tc_v2_sig_verify_v1"

type vectorFile struct {
	ID              string `json:"id"`
	Contract        string `json:"contract"`
	OperatorPubkey  string `json:"operator_pubkey_hex"`
	SignatureB64    string `json:"signature_b64"`
	DigestFromInput bool   `json:"digest_from_input"`
	Input           struct {
		Workchain    int32  `json:"workchain"`
		AddressHash  string `json:"address_hash_hex"`
		Domain       string `json:"domain"`
		Timestamp    uint64 `json:"timestamp"`
		PayloadType  string `json:"payload_type"`
		PayloadB64   string `json:"payload_b64"`
		PayloadText  string `json:"payload_text"`
		ProofPayload string `json:"proof_payload"`
	} `json:"input"`
	Expect struct {
		Digest  string `json:"digest_sha256_hex"`
		Verdict bool   `json:"verdict"`
	} `json:"expect"`
}

type manifestFile struct {
	Vectors struct {
		Positive     []string `json:"positive"`
		Negative     []string `json:"negative"`
		CrossChannel []string `json:"cross-channel"`
	} `json:"vectors"`
}

func mustHex(t *testing.T, s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("hex %q: %v", s, err)
	}
	return b
}

func TestParityWithTypeScriptGoldenVectors(t *testing.T) {
	mdata, err := os.ReadFile(filepath.Join(pkgDir, "manifest.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var m manifestFile
	if err := json.Unmarshal(mdata, &m); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	all := append(append(append([]string{}, m.Vectors.Positive...), m.Vectors.Negative...), m.Vectors.CrossChannel...)

	digestChecked, verdictChecked, countA, countB := 0, 0, 0, 0
	for _, rel := range all {
		data, err := os.ReadFile(filepath.Join(pkgDir, rel))
		if err != nil {
			t.Fatalf("read %s: %v", rel, err)
		}
		var v vectorFile
		if err := json.Unmarshal(data, &v); err != nil {
			t.Fatalf("parse %s: %v", rel, err)
		}

		pub := mustHex(t, v.OperatorPubkey)
		sig, err := base64.StdEncoding.DecodeString(v.SignatureB64)
		if err != nil {
			t.Fatalf("%s: signature b64: %v", v.ID, err)
		}
		var ah [32]byte
		copy(ah[:], mustHex(t, v.Input.AddressHash))

		var computed [32]byte
		switch v.Contract {
		case "TC_V2_SIGNDATA_VERIFY_V1":
			computed = SignDataDigest(SignDataInput{
				Workchain: v.Input.Workchain, AddressHash: ah, Domain: v.Input.Domain,
				Timestamp: v.Input.Timestamp, PayloadType: v.Input.PayloadType,
				PayloadText: v.Input.PayloadText, PayloadB64: v.Input.PayloadB64,
			})
			countA++
		case "TC_V2_TONPROOF_VERIFY_V1":
			computed = TonProofDigest(TonProofInput{
				Workchain: v.Input.Workchain, AddressHash: ah, Domain: v.Input.Domain,
				Timestamp: v.Input.Timestamp, ProofPayload: v.Input.ProofPayload,
			})
			countB++
		default:
			t.Fatalf("%s: unknown contract %q", v.ID, v.Contract)
		}

		// axis 1 — digest parity
		digestToVerify := mustHex(t, v.Expect.Digest)
		if v.DigestFromInput {
			if hex.EncodeToString(computed[:]) != v.Expect.Digest {
				t.Errorf("%s: digest mismatch: got %s want %s", v.ID, hex.EncodeToString(computed[:]), v.Expect.Digest)
			}
			digestToVerify = computed[:] // use Go's own digest -> full independent chain
			digestChecked++
		}

		// axis 2 — verdict via Go's std ed25519
		got := ed25519.Verify(ed25519.PublicKey(pub), digestToVerify, sig)
		if got != v.Expect.Verdict {
			t.Errorf("%s: verdict %v, want %v", v.ID, got, v.Expect.Verdict)
		}
		verdictChecked++
	}

	if digestChecked != 14 {
		t.Errorf("digest axis: checked %d, want 14", digestChecked)
	}
	if verdictChecked != 15 {
		t.Errorf("verdict axis: checked %d, want 15", verdictChecked)
	}
	if countA != 13 || countB != 2 {
		t.Errorf("per-verifier counts: A=%d (want 13), B=%d (want 2)", countA, countB)
	}
	t.Logf("Go parity: digest %d/14, verdict %d/15; signData-verifier %d, tonProof-verifier %d", digestChecked, verdictChecked, countA, countB)
}
