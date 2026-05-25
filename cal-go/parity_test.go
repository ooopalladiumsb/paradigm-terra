package cal

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Byte-for-byte parity against the TypeScript reference golden vectors
// (../cal/vectors/golden.json, from @paradigm-terra/cal): validation outcome
// (code + detail), CAL_HASH, canonical unsigned bytes, event/receipt hashes.

type goldenDoc struct {
	Cals []struct {
		ID           string `json:"id"`
		CalCanonical string `json:"cal_canonical"`
		Output       struct {
			Valid            bool   `json:"valid"`
			Code             string `json:"code"`
			Detail           string `json:"detail"`
			CalHash          string `json:"cal_hash"`
			UnsignedBytesHex string `json:"unsigned_bytes_hex"`
		} `json:"output"`
	} `json:"cals"`
	Events []struct {
		ID             string `json:"id"`
		EventCanonical string `json:"event_canonical"`
		Output         struct {
			EventHash   string `json:"event_hash"`
			ReceiptHash string `json:"receipt_hash"`
		} `json:"output"`
	} `json:"events"`
}

func hexHash(h [32]byte) string { return "0x" + hex.EncodeToString(h[:]) }

func TestParityWithTypeScriptGoldenVectors(t *testing.T) {
	data, err := os.ReadFile("../cal/vectors/golden.json")
	if err != nil {
		t.Fatalf("read golden.json: %v", err)
	}
	var doc goldenDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse golden.json: %v", err)
	}
	if len(doc.Cals) < 11 {
		t.Fatalf("expected >=11 CAL vectors, got %d", len(doc.Cals))
	}

	checks := 0
	for _, v := range doc.Cals {
		cal, perr := canonical.ParseCanonical(v.CalCanonical)
		if perr != nil {
			t.Fatalf("%s: parse cal: %v", v.ID, perr)
		}
		res := CheckCal(cal)
		checks++
		if res.Valid != v.Output.Valid {
			t.Errorf("%s.valid: got %v want %v", v.ID, res.Valid, v.Output.Valid)
		}
		if res.Code != v.Output.Code {
			t.Errorf("%s.code: got %q want %q", v.ID, res.Code, v.Output.Code)
		}
		if res.Detail != v.Output.Detail {
			t.Errorf("%s.detail: got %q want %q", v.ID, res.Detail, v.Output.Detail)
		}
		if v.Output.Valid {
			checks += 2
			h, _ := CalHash(cal)
			if got := hexHash(h); got != v.Output.CalHash {
				t.Errorf("%s.cal_hash: got %s want %s", v.ID, got, v.Output.CalHash)
			}
			b, _ := CanonicalUnsignedBytes(cal)
			if got := "0x" + hex.EncodeToString(b); got != v.Output.UnsignedBytesHex {
				t.Errorf("%s.unsigned_bytes: got %s want %s", v.ID, got, v.Output.UnsignedBytesHex)
			}
		}
	}

	for _, e := range doc.Events {
		ev, perr := canonical.ParseCanonical(e.EventCanonical)
		if perr != nil {
			t.Fatalf("%s: parse event: %v", e.ID, perr)
		}
		eh, _ := EventHash(ev)
		rh, _ := ReceiptHash(ev)
		checks += 2
		if got := hexHash(eh); got != e.Output.EventHash {
			t.Errorf("%s.event_hash: got %s want %s", e.ID, got, e.Output.EventHash)
		}
		if got := hexHash(rh); got != e.Output.ReceiptHash {
			t.Errorf("%s.receipt_hash: got %s want %s", e.ID, got, e.Output.ReceiptHash)
		}
	}

	if !t.Failed() {
		t.Logf("All %d parity checks passed against TypeScript golden vectors.", checks)
	}
}
