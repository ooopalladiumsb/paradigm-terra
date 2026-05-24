package canonical

import (
	"encoding/hex"
	"testing"
)

func TestStateTickCanonicalBytes(t *testing.T) {
	// Genesis tick — these are exactly the bytes that feed the NORMATIVE
	// state_root_genesis_empty golden vector.
	genesis := StateTick{Current: 0, Genesis: 0, BlocksPerTick: 12, Epoch: 0}
	cb, err := genesis.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"blocks_per_tick":12,"current":0,"epoch":0,"genesis":0}`
	if string(cb) != want {
		t.Fatalf("genesis canonical bytes:\n  want %s\n  got  %s", want, cb)
	}

	// Non-zero KAT: keys stay sorted, integers exact (incl. > 2^20).
	tick := StateTick{Current: 1050000, Genesis: 1, BlocksPerTick: 12, Epoch: 7}
	cb2, err := tick.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	want2 := `{"blocks_per_tick":12,"current":1050000,"epoch":7,"genesis":1}`
	if string(cb2) != want2 {
		t.Fatalf("canonical bytes:\n  want %s\n  got  %s", want2, cb2)
	}
}

func TestStateTickLeafHashWiring(t *testing.T) {
	tick := StateTick{Current: 0, Genesis: 0, BlocksPerTick: 12, Epoch: 0}
	got, err := tick.LeafHash()
	if err != nil {
		t.Fatal(err)
	}

	// LeafHash must equal the generic state-namespace machinery (which
	// parity_test.go validates against the golden state root).
	cb, _ := tick.CanonicalBytes()
	want, err := StateNamespaceLeafHash(StateNamespace{Name: TickNamespace, CanonicalBytes: cb})
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("leaf hash mismatch:\n  got  %s\n  want %s",
			hex.EncodeToString(got[:]), hex.EncodeToString(want[:]))
	}
}
