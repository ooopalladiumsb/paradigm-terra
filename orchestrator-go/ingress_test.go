package orchestrator

// Go leg of the Gate #1 contour: real Ed25519 keys produce real signatures; VerifyIngress
// derives the trace booleans from them (no injection). Go's std crypto/ed25519 is the second
// independent node-verifier oracle after TS.

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"testing"

	calgo "github.com/paradigm-terra/cal-go"
	tcv2 "github.com/paradigm-terra/tc-v2-verify-go"
	canonical "github.com/paradigm-terra/canonical-go"
)

const aHashHex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" // 32 bytes
const domain = "ooopalladiumsb.github.io"
const ts uint64 = 1780211353

func core() []canonical.Pair {
	return []canonical.Pair{
		{Key: "action", Val: "wallet.send_ton"},
		{Key: "agent_id", Val: "0:" + aHashHex},
		{Key: "nonce", Val: canonical.Int("1")},
	}
}

func TestVerifyIngressDerivesVerdictsFromRealSignatures(t *testing.T) {
	opPub, opPriv, _ := ed25519.GenerateKey(rand.Reader)
	ownerPub, ownerPriv, _ := ed25519.GenerateKey(rand.Reader)
	opPubHex := "0x" + hex.EncodeToString(opPub)
	ownerPubHex := "0x" + hex.EncodeToString(ownerPub)

	cb, err := calgo.CanonicalUnsignedBytes(canonical.NewObject(core()...))
	if err != nil {
		t.Fatalf("canonical bytes: %v", err)
	}
	operatorSig := "0x" + hex.EncodeToString(ed25519.Sign(opPriv, cb))

	var ah [32]byte
	h, _ := hex.DecodeString(aHashHex)
	copy(ah[:], h)
	digest := tcv2.SignDataDigest(tcv2.SignDataInput{
		Workchain: 0, AddressHash: ah, Domain: domain, Timestamp: ts,
		PayloadType: "binary", PayloadB64: base64.StdEncoding.EncodeToString(cb),
	})
	ownerSig := "0x" + hex.EncodeToString(ed25519.Sign(ownerPriv, digest[:]))

	ownerEnv := canonical.NewObject(
		canonical.Pair{Key: "signature", Val: ownerSig},
		canonical.Pair{Key: "domain", Val: domain},
		canonical.Pair{Key: "timestamp", Val: canonical.Int(strconv.FormatUint(ts, 10))},
		canonical.Pair{Key: "workchain", Val: canonical.Int("0")},
		canonical.Pair{Key: "address_hash", Val: "0x" + aHashHex},
	)
	mkCal := func(ownerSigVal canonical.Value) canonical.Value {
		sigs := canonical.NewObject(
			canonical.Pair{Key: "operator_sig", Val: operatorSig},
			canonical.Pair{Key: "owner_sig", Val: ownerSigVal},
		)
		return canonical.NewObject(append(core(), canonical.Pair{Key: "signatures", Val: sigs})...)
	}

	// positive: both verdicts true from real signatures
	v := VerifyIngress(mkCal(ownerEnv), opPubHex, ownerPubHex)
	if !v.OperatorSigPresent || !v.OwnerSigPresent {
		t.Fatalf("expected both true, got %+v", v)
	}

	// wrong operator pubkey
	if VerifyIngress(mkCal(ownerEnv), ownerPubHex, ownerPubHex).OperatorSigPresent {
		t.Error("wrong operator pubkey must fail")
	}
	// legacy hex-string owner_sig: no backfill (D-S4) → ownerSigPresent=false
	if VerifyIngress(mkCal("0x"+aHashHex+aHashHex), opPubHex, ownerPubHex).OwnerSigPresent {
		t.Error("legacy owner_sig string must yield ownerSigPresent=false (no backfill)")
	}
	// missing owner key → false
	if VerifyIngress(mkCal(ownerEnv), opPubHex, "").OwnerSigPresent {
		t.Error("empty owner pubkey must yield false")
	}
}
