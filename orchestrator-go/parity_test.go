package orchestrator

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"

	calvalidator "github.com/paradigm-terra/cal-validator-go"
	canonical "github.com/paradigm-terra/canonical-go"
)

// Byte-for-byte parity against the TypeScript reference golden vectors
// (../orchestrator/vectors/golden.json): for each program, the full canonical
// event log, per-tick STATE_ROOT + global Merkle root, and per-submission terminal
// stage / reason code / event types / per-event STATE_ROOTs. Programs are
// reconstructed from the stored canonical start state + per-submission CAL/trace.

type orchGolden struct {
	Programs []struct {
		ID                  string `json:"id"`
		StartStateCanonical string `json:"start_state_canonical"`
		InputTicks          []struct {
			Tick        string `json:"tick"`
			Submissions []struct {
				CalCanonical   string `json:"cal_canonical"`
				TraceCanonical string `json:"trace_canonical"`
				Mode           string `json:"mode"`
			} `json:"submissions"`
		} `json:"input_ticks"`
		Expected struct {
			EventLog       []string `json:"event_log"`
			FinalStateRoot string   `json:"final_state_root"`
			Ticks          []struct {
				Tick             string `json:"tick"`
				StateRoot        string `json:"state_root"`
				GlobalMerkleRoot string `json:"global_merkle_root"`
				Submissions      []struct {
					CalHash       string   `json:"cal_hash"`
					TerminalStage *string  `json:"terminal_stage"`
					ReasonCode    *string  `json:"reason_code"`
					EventTypes    []string `json:"event_types"`
					StateRoots    []string `json:"state_roots"`
				} `json:"submissions"`
			} `json:"ticks"`
		} `json:"expected"`
	} `json:"programs"`
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

func buildTrace(j canonical.Value) calvalidator.ExecutionTrace {
	o, _ := j.(*canonical.Object)
	get := func(k string) canonical.Value { v, _ := o.Get(k); return v }
	var steps []calvalidator.StepResult
	if sv, ok := o.Get("steps"); ok {
		if arr, ok := sv.([]canonical.Value); ok {
			for _, s := range arr {
				so, _ := s.(*canonical.Object)
				st := calvalidator.StepResult{OK: boolOf(mustGet(so, "ok"))}
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
	return calvalidator.ExecutionTrace{
		CurrentTick:         bigOf(get("current_tick")),
		Steps:               steps,
		StateBefore:         get("state_before"),
		StateAfter:          get("state_after"),
		OperatorSigPresent:  boolOf(get("operator_sig_present")),
		OwnerSigPresent:     boolOf(get("owner_sig_present")),
		PinnedMCPSchemaHash: pinned,
	}
}

func mustGet(o *canonical.Object, k string) canonical.Value {
	if o == nil {
		return nil
	}
	v, _ := o.Get(k)
	return v
}

func eqStrPtr(got, want *string) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	return *got == *want
}

func eqStrSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestParityWithTypeScriptGoldenVectors(t *testing.T) {
	data, err := os.ReadFile("../orchestrator/vectors/golden.json")
	if err != nil {
		t.Fatalf("read golden.json: %v", err)
	}
	var doc orchGolden
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse golden.json: %v", err)
	}
	if len(doc.Programs) < 3 {
		t.Fatalf("expected at least 3 orchestrator programs, got %d", len(doc.Programs))
	}
	checks := 0

	for _, p := range doc.Programs {
		genesis, perr := canonical.ParseCanonical(p.StartStateCanonical)
		if perr != nil {
			t.Fatalf("%s: parse start state: %v", p.ID, perr)
		}

		var ticks []TickBlock
		for _, blk := range p.InputTicks {
			tk, good := new(big.Int).SetString(blk.Tick, 10)
			if !good {
				t.Fatalf("%s: bad tick %q", p.ID, blk.Tick)
			}
			var subs []Submission
			for _, s := range blk.Submissions {
				calV, e1 := canonical.ParseCanonical(s.CalCanonical)
				traceV, e2 := canonical.ParseCanonical(s.TraceCanonical)
				if e1 != nil || e2 != nil {
					t.Fatalf("%s: parse submission: %v / %v", p.ID, e1, e2)
				}
				mode := ModeAtomic
				switch s.Mode {
				case "validate-only":
					mode = ModeValidateOnly
				case "resume":
					mode = ModeResume
				}
				subs = append(subs, Submission{Cal: calV, Trace: buildTrace(traceV), Mode: mode})
			}
			ticks = append(ticks, TickBlock{Tick: tk, Submissions: subs})
		}

		tr, nerr := Run(&Program{GenesisState: genesis, Ticks: ticks})
		if nerr != nil {
			t.Fatalf("%s: run: %v", p.ID, nerr)
		}
		exp := p.Expected

		// Full canonical event log.
		checks++
		if len(tr.EventLog) != len(exp.EventLog) {
			t.Errorf("%s: event_log length got %d want %d", p.ID, len(tr.EventLog), len(exp.EventLog))
		} else {
			for i, ev := range tr.EventLog {
				b, e := canonical.CanonicalizeValue(ev)
				if e != nil {
					t.Fatalf("%s: serialize event %d: %v", p.ID, i, e)
				}
				if string(b) != exp.EventLog[i] {
					t.Errorf("%s: event_log[%d]\n  got %s\n  want %s", p.ID, i, string(b), exp.EventLog[i])
				}
			}
		}

		checks++
		if tr.FinalStateRoot != exp.FinalStateRoot {
			t.Errorf("%s: final_state_root got %s want %s", p.ID, tr.FinalStateRoot, exp.FinalStateRoot)
		}

		checks++
		if len(tr.Ticks) != len(exp.Ticks) {
			t.Fatalf("%s: tick count got %d want %d", p.ID, len(tr.Ticks), len(exp.Ticks))
		}
		for k, tk := range tr.Ticks {
			gk := exp.Ticks[k]
			checks++
			if tk.Tick.String() != gk.Tick {
				t.Errorf("%s t%d: tick got %s want %s", p.ID, k, tk.Tick, gk.Tick)
			}
			checks++
			if tk.StateRoot != gk.StateRoot {
				t.Errorf("%s t%d: state_root got %s want %s", p.ID, k, tk.StateRoot, gk.StateRoot)
			}
			checks++
			if tk.GlobalMerkleRoot != gk.GlobalMerkleRoot {
				t.Errorf("%s t%d: global_merkle_root got %s want %s", p.ID, k, tk.GlobalMerkleRoot, gk.GlobalMerkleRoot)
			}
			checks++
			if len(tk.Submissions) != len(gk.Submissions) {
				t.Fatalf("%s t%d: sub count got %d want %d", p.ID, k, len(tk.Submissions), len(gk.Submissions))
			}
			for j, s := range tk.Submissions {
				gs := gk.Submissions[j]
				checks++
				if s.CalHash != gs.CalHash {
					t.Errorf("%s t%d s%d: cal_hash got %s want %s", p.ID, k, j, s.CalHash, gs.CalHash)
				}
				checks++
				if !eqStrPtr(s.TerminalStage, gs.TerminalStage) {
					t.Errorf("%s t%d s%d: terminal_stage mismatch", p.ID, k, j)
				}
				checks++
				if !eqStrPtr(s.ReasonCode, gs.ReasonCode) {
					t.Errorf("%s t%d s%d: reason_code mismatch", p.ID, k, j)
				}
				checks++
				if !eqStrSlice(s.EventTypes, gs.EventTypes) {
					t.Errorf("%s t%d s%d: event_types got %v want %v", p.ID, k, j, s.EventTypes, gs.EventTypes)
				}
				checks++
				if !eqStrSlice(s.StateRoots, gs.StateRoots) {
					t.Errorf("%s t%d s%d: state_roots got %v want %v", p.ID, k, j, s.StateRoots, gs.StateRoots)
				}
			}
		}
	}

	if !t.Failed() {
		t.Logf("All %d orchestrator parity checks passed against TypeScript golden vectors.", checks)
	}
}
