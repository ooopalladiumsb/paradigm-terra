package calreducer

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Byte-for-byte parity against the TypeScript reference golden vectors
// (../cal-reducer/vectors/golden.json): genesis STATE_ROOT, per-event
// STATE_ROOTs, and ApplyError codes.

type goldenDoc struct {
	GenesisStateRoot string `json:"genesis_state_root"`
	Sequences        []struct {
		ID                  string   `json:"id"`
		StartStateCanonical string   `json:"start_state_canonical"`
		Events              []string `json:"events"`
		ExpectedRoots       []string `json:"expected_roots"`
	} `json:"sequences"`
	Errors []struct {
		ID                  string `json:"id"`
		StartStateCanonical string `json:"start_state_canonical"`
		EventCanonical      string `json:"event_canonical"`
		ExpectedErrorCode   string `json:"expected_error_code"`
	} `json:"errors"`
}

func hx(b [32]byte) string { return "0x" + hex.EncodeToString(b[:]) }

func TestParityWithTypeScriptGoldenVectors(t *testing.T) {
	data, err := os.ReadFile("../cal-reducer/vectors/golden.json")
	if err != nil {
		t.Fatalf("read golden.json: %v", err)
	}
	var doc goldenDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse golden.json: %v", err)
	}
	checks := 0

	// genesis root
	checks++
	if got, _ := StateRootOf(Genesis()); hx(got) != doc.GenesisStateRoot {
		t.Errorf("genesis_state_root: got %s want %s", hx(got), doc.GenesisStateRoot)
	}

	for _, s := range doc.Sequences {
		start, perr := canonical.ParseCanonical(s.StartStateCanonical)
		if perr != nil {
			t.Fatalf("%s: parse start: %v", s.ID, perr)
		}
		events := make([]canonical.Value, len(s.Events))
		for i, e := range s.Events {
			ev, perr := canonical.ParseCanonical(e)
			if perr != nil {
				t.Fatalf("%s: parse event %d: %v", s.ID, i, perr)
			}
			events[i] = ev
		}
		roots, ferr := ScanStateRoots(events, start)
		checks++
		if ferr != nil {
			t.Errorf("%s: unexpected ApplyError %s at %d", s.ID, ferr.Code, ferr.Index)
			continue
		}
		if len(roots) != len(s.ExpectedRoots) {
			t.Errorf("%s: root count got %d want %d", s.ID, len(roots), len(s.ExpectedRoots))
			continue
		}
		for i, r := range roots {
			if hx(r) != s.ExpectedRoots[i] {
				t.Errorf("%s[%d]: got %s want %s", s.ID, i, hx(r), s.ExpectedRoots[i])
			}
		}
	}

	for _, e := range doc.Errors {
		start, _ := canonical.ParseCanonical(e.StartStateCanonical)
		event, _ := canonical.ParseCanonical(e.EventCanonical)
		_, aerr := Apply(start, event)
		checks++
		if aerr == nil {
			t.Errorf("%s: expected ApplyError %s, got nil", e.ID, e.ExpectedErrorCode)
		} else if aerr.Code != e.ExpectedErrorCode {
			t.Errorf("%s: got %s want %s", e.ID, aerr.Code, e.ExpectedErrorCode)
		}
	}

	if !t.Failed() {
		t.Logf("All %d parity checks passed against TypeScript golden vectors.", checks)
	}
}
