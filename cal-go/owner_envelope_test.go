package cal

// §8.4 dual-accept: owner_sig as the Contract A envelope object (D-S1/D-S2) and legacy hex.
// Parity with cal/test/schema.test.ts and cal-rs owner_envelope_tests.

import (
	"strings"
	"testing"

	canonical "github.com/paradigm-terra/canonical-go"
)

func hexBytes(n int) string { return "0x" + strings.Repeat("ab", n) }

func basePairs() []canonical.Pair {
	return []canonical.Pair{
		{Key: "signature", Val: hexBytes(64)},
		{Key: "domain", Val: "ooopalladiumsb.github.io"},
		{Key: "timestamp", Val: canonical.Int("1780211353")},
		{Key: "workchain", Val: canonical.Int("0")},
		{Key: "address_hash", Val: hexBytes(32)},
	}
}

func sigsWith(owner canonical.Value) canonical.Value {
	return canonical.NewObject(
		canonical.Pair{Key: "operator_sig", Val: hexBytes(64)},
		canonical.Pair{Key: "owner_sig", Val: owner},
	)
}

func TestOwnerSigEnvelopeObjectAccepts(t *testing.T) {
	if e := validateSignatures(sigsWith(canonical.NewObject(basePairs()...))); e != nil {
		t.Errorf("object form should validate, got %v", e)
	}
}

func TestOwnerSigLegacyStringAccepts(t *testing.T) {
	if e := validateSignatures(sigsWith(hexBytes(64))); e != nil {
		t.Errorf("legacy hex string should validate, got %v", e)
	}
}

func TestOwnerSigEnvelopeMalformedRejects(t *testing.T) {
	mut := func(f func(p []canonical.Pair) []canonical.Pair) canonical.Value {
		return sigsWith(canonical.NewObject(f(basePairs())...))
	}
	cases := map[string]canonical.Value{
		"empty domain": mut(func(p []canonical.Pair) []canonical.Pair { p[1].Val = ""; return p }),
		"short address_hash": mut(func(p []canonical.Pair) []canonical.Pair { p[4].Val = hexBytes(2); return p }),
		"non-int workchain": mut(func(p []canonical.Pair) []canonical.Pair { p[3].Val = "0"; return p }),
		"unexpected field": mut(func(p []canonical.Pair) []canonical.Pair {
			return append(p, canonical.Pair{Key: "x", Val: canonical.Int("1")})
		}),
		"missing signature": mut(func(p []canonical.Pair) []canonical.Pair { return p[1:] }),
	}
	for name, sig := range cases {
		if e := validateSignatures(sig); e == nil {
			t.Errorf("%s: expected rejection, got ok", name)
		}
	}
}
