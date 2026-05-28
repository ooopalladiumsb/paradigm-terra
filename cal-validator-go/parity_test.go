package calvalidator

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Byte-for-byte parity against the TypeScript reference golden vectors
// (../validator/vectors/golden.json): for each (cal, snapshot, trace), the
// emitted event_type sequence, terminal stage, reason code, the economic event
// fields, and the full §9.4 bill.

type goldenDoc struct {
	Vectors []struct {
		ID                string `json:"id"`
		CalHash           string `json:"cal_hash"`
		CalCanonical      string `json:"cal_canonical"`
		SnapshotCanonical string `json:"snapshot_canonical"`
		TraceCanonical    string `json:"trace_canonical"`
		Output            struct {
			EventTypes    []string `json:"event_types"`
			TerminalStage string   `json:"terminal_stage"`
			ReasonCode         *string `json:"reason_code"`
			Escrow             *string `json:"escrow_ptra"`
			TerminalFeeDebited *string `json:"terminal_fee_debited_ptra"`
			GasConsumed        *string `json:"gas_consumed_ptra"`
			GasRefunded   *string  `json:"gas_refunded_ptra"`
			Bill          struct {
				FeeRetained        string `json:"fee_retained"`
				DynamicGasConsumed string `json:"dynamic_gas_consumed"`
				GasRefunded        string `json:"gas_refunded"`
				TotalAgentCharge   string `json:"total_agent_charge"`
			} `json:"bill"`
		} `json:"output"`
	} `json:"vectors"`
}

func boolOf(v canonical.Value) bool { b, _ := v.(bool); return b }

func bigOf(v canonical.Value) *big.Int {
	if iv, ok := v.(canonical.Int); ok {
		if n, good := new(big.Int).SetString(string(iv), 10); good {
			return n
		}
	}
	return big.NewInt(0)
}

func buildTrace(j canonical.Value) ExecutionTrace {
	o, _ := j.(*canonical.Object)
	get := func(k string) canonical.Value { v, _ := o.Get(k); return v }
	var steps []StepResult
	if sv, ok := o.Get("steps"); ok {
		if arr, ok := sv.([]canonical.Value); ok {
			for _, s := range arr {
				so, _ := s.(*canonical.Object)
				st := StepResult{OK: boolOf(mustObjGet(so, "ok"))}
				if ev, ok := so.Get("effects"); ok {
					if ea, ok := ev.([]canonical.Value); ok {
						st.Effects = ea
					}
				}
				if ed, ok := so.Get("error_detail"); ok {
					if s, ok := ed.(string); ok {
						st.ErrorDetail = s
					}
				}
				steps = append(steps, st)
			}
		}
	}
	pinned := ""
	if p, ok := get("pinned_mcp_schema_hash").(string); ok {
		pinned = p
	}
	return ExecutionTrace{
		CurrentTick:         bigOf(get("current_tick")),
		Steps:               steps,
		StateBefore:         get("state_before"),
		StateAfter:          get("state_after"),
		OwnerSigPresent:     boolOf(get("owner_sig_present")),
		PinnedMCPSchemaHash: pinned,
	}
}

func mustObjGet(o *canonical.Object, k string) canonical.Value {
	if o == nil {
		return nil
	}
	v, _ := o.Get(k)
	return v
}

// evInt returns the decimal-string value of key in the first event of type etype.
func evInt(events []canonical.Value, etype, key string) (string, bool) {
	for _, e := range events {
		o, ok := e.(*canonical.Object)
		if !ok {
			continue
		}
		if et, _ := o.Get("event_type"); et == etype {
			if v, ok := o.Get(key); ok {
				if iv, ok := v.(canonical.Int); ok {
					return string(iv), true
				}
			}
			return "", false
		}
	}
	return "", false
}

func eqOpt(got string, gotPresent bool, want *string) bool {
	if want == nil {
		return !gotPresent
	}
	return gotPresent && got == *want
}

func TestParityWithTypeScriptGoldenVectors(t *testing.T) {
	data, err := os.ReadFile("../validator/vectors/golden.json")
	if err != nil {
		t.Fatalf("read golden.json: %v", err)
	}
	var doc goldenDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse golden.json: %v", err)
	}
	if len(doc.Vectors) < 12 {
		t.Fatalf("expected at least 12 validator vectors, got %d", len(doc.Vectors))
	}
	checks := 0

	for _, v := range doc.Vectors {
		cal, e1 := canonical.ParseCanonical(v.CalCanonical)
		snapshot, e2 := canonical.ParseCanonical(v.SnapshotCanonical)
		traceV, e3 := canonical.ParseCanonical(v.TraceCanonical)
		if e1 != nil || e2 != nil || e3 != nil {
			t.Fatalf("%s: parse inputs: %v / %v / %v", v.ID, e1, e2, e3)
		}
		res, verr := Validate(cal, v.CalHash, snapshot, buildTrace(traceV))
		if verr != nil {
			t.Fatalf("%s: validate: %v", v.ID, verr)
		}
		o := v.Output

		gotTypes := make([]string, 0, len(res.Events))
		for _, e := range res.Events {
			eo, _ := e.(*canonical.Object)
			et, _ := eo.Get("event_type")
			gotTypes = append(gotTypes, asStr(et))
		}
		checks++
		if len(gotTypes) != len(o.EventTypes) {
			t.Errorf("%s: event_types got %v want %v", v.ID, gotTypes, o.EventTypes)
		} else {
			for i := range gotTypes {
				if gotTypes[i] != o.EventTypes[i] {
					t.Errorf("%s: event_types[%d] got %s want %s", v.ID, i, gotTypes[i], o.EventTypes[i])
				}
			}
		}

		checks++
		if res.TerminalStage != o.TerminalStage {
			t.Errorf("%s: terminal_stage got %s want %s", v.ID, res.TerminalStage, o.TerminalStage)
		}
		checks++
		if !eqOpt(res.ReasonCode, res.ReasonCode != "", o.ReasonCode) {
			t.Errorf("%s: reason_code got %q want %v", v.ID, res.ReasonCode, o.ReasonCode)
		}

		// §9.3 upfront escrow: cal.validated carries escrow_ptra = fee + Max_Expected_Dynamic_Gas.
		escGot, escOk := evInt(res.Events, "cal.validated", "escrow_ptra")
		checks++
		if !eqOpt(escGot, escOk, o.Escrow) {
			t.Errorf("%s: escrow got %q(%v) want %v", v.ID, escGot, escOk, o.Escrow)
		}

		// Terminal-event economics: §9.4 Tier-2 pre-VALIDATED spam charge (fee_debited_ptra),
		// the consumed gas, and the §9.3 unused-gas refund (gas_refunded_ptra).
		tfGot, tfOk := "", false
		gcGot, gcOk := "", false
		grGot, grOk := "", false
		if len(res.Events) > 0 {
			if eo, ok := res.Events[len(res.Events)-1].(*canonical.Object); ok {
				if v, ok := eo.Get("fee_debited_ptra"); ok {
					if iv, ok := v.(canonical.Int); ok {
						tfGot, tfOk = string(iv), true
					}
				}
				if v, ok := eo.Get("gas_consumed_ptra"); ok {
					if iv, ok := v.(canonical.Int); ok {
						gcGot, gcOk = string(iv), true
					}
				}
				if v, ok := eo.Get("gas_refunded_ptra"); ok {
					if iv, ok := v.(canonical.Int); ok {
						grGot, grOk = string(iv), true
					}
				}
			}
		}
		checks++
		if !eqOpt(tfGot, tfOk, o.TerminalFeeDebited) {
			t.Errorf("%s: terminal_fee_debited got %q(%v) want %v", v.ID, tfGot, tfOk, o.TerminalFeeDebited)
		}
		checks++
		if !eqOpt(gcGot, gcOk, o.GasConsumed) {
			t.Errorf("%s: gas_consumed got %q(%v) want %v", v.ID, gcGot, gcOk, o.GasConsumed)
		}
		checks++
		if !eqOpt(grGot, grOk, o.GasRefunded) {
			t.Errorf("%s: gas_refunded got %q(%v) want %v", v.ID, grGot, grOk, o.GasRefunded)
		}

		for _, c := range []struct {
			name, got, want string
		}{
			{"fee_retained", res.Bill.FeeRetained.String(), o.Bill.FeeRetained},
			{"dynamic_gas_consumed", res.Bill.DynamicGasConsumed.String(), o.Bill.DynamicGasConsumed},
			{"gas_refunded", res.Bill.GasRefunded.String(), o.Bill.GasRefunded},
			{"total_agent_charge", res.Bill.TotalAgentCharge.String(), o.Bill.TotalAgentCharge},
		} {
			checks++
			if c.got != c.want {
				t.Errorf("%s: bill.%s got %s want %s", v.ID, c.name, c.got, c.want)
			}
		}
	}

	if !t.Failed() {
		t.Logf("All %d validator parity checks passed against TypeScript golden vectors.", checks)
	}
}
