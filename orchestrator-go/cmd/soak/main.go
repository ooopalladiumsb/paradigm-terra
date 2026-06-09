// OVT-3 (H3.2 / H3.3) — CONTINUOUS cross-language parity soak, GO side.
//
// The golden vectors prove TS == Go point-wise (a Freeze-Surface axiom). This verifier
// falsifies a different claim: that the runtimes could agree point-wise yet *drift*
// under a long, continuous, multi-agent stream. It reads the soak stream pinned by the
// TS reference (orchestrator/scripts/ovt3-soak-stream.ts → orchestrator/vectors/soak-stream.json),
// re-folds the IDENTICAL stream through the live Go node, and must reproduce — with 0
// divergences — every per-tick STATE_ROOT, every per-tick CE §6.3 global Merkle root,
// the final STATE_ROOT, the event count, and a SHA-256 over the whole canonical event
// log (full event-log parity without shipping every event string).
//
//	CGO_ENABLED=0 go run ./cmd/soak [path-to-soak-stream.json]   # from orchestrator-go/
//
// Exit 0 iff every Go-computed value equals the TS-produced value pinned in the stream.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"

	calvalidator "github.com/paradigm-terra/cal-validator-go"
	canonical "github.com/paradigm-terra/canonical-go"
	orch "github.com/paradigm-terra/orchestrator-go"
)

type soakDoc struct {
	Meta       map[string]interface{} `json:"meta"`
	StartState string                 `json:"start_state_canonical"`
	InputTicks []struct {
		Tick        string `json:"tick"`
		Submissions []struct {
			CalCanonical   string `json:"cal_canonical"`
			TraceCanonical string `json:"trace_canonical"`
			Mode           string `json:"mode"`
		} `json:"submissions"`
	} `json:"input_ticks"`
	Expected struct {
		FinalStateRoot string `json:"final_state_root"`
		EventCount     int    `json:"event_count"`
		EventLogSha256 string `json:"event_log_sha256"`
		Ticks          []struct {
			Tick             string `json:"tick"`
			StateRoot        string `json:"state_root"`
			GlobalMerkleRoot string `json:"global_merkle_root"`
		} `json:"ticks"`
	} `json:"expected"`
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

// buildTrace mirrors orchestrator-go/parity_test.go's buildTrace: a parsed canonical
// trace object → calvalidator.ExecutionTrace.
func buildTrace(j canonical.Value) calvalidator.ExecutionTrace {
	o, _ := j.(*canonical.Object)
	get := func(k string) canonical.Value { v, _ := o.Get(k); return v }
	var steps []calvalidator.StepResult
	if sv, ok := o.Get("steps"); ok {
		if arr, ok := sv.([]canonical.Value); ok {
			for _, s := range arr {
				so, _ := s.(*canonical.Object)
				okv, _ := so.Get("ok")
				st := calvalidator.StepResult{OK: boolOf(okv)}
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

func modeOf(s string) orch.SubmissionMode {
	switch s {
	case "validate-only":
		return orch.ModeValidateOnly
	case "resume":
		return orch.ModeResume
	default:
		return orch.ModeAtomic
	}
}

func fail(format string, a ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

func main() {
	path := "../orchestrator/vectors/soak-stream.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		fail("read %s: %v\n(generate it first: cd ../orchestrator && node --import tsx scripts/ovt3-soak-stream.ts)", path, err)
	}
	var doc soakDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		fail("parse %s: %v", path, err)
	}

	genesis, perr := canonical.ParseCanonical(doc.StartState)
	if perr != nil {
		fail("parse start state: %v", perr)
	}

	var ticks []orch.TickBlock
	subCount := 0
	for _, blk := range doc.InputTicks {
		tk, good := new(big.Int).SetString(blk.Tick, 10)
		if !good {
			fail("bad tick %q", blk.Tick)
		}
		var subs []orch.Submission
		for _, s := range blk.Submissions {
			calV, e1 := canonical.ParseCanonical(s.CalCanonical)
			traceV, e2 := canonical.ParseCanonical(s.TraceCanonical)
			if e1 != nil || e2 != nil {
				fail("parse submission: %v / %v", e1, e2)
			}
			subs = append(subs, orch.Submission{Cal: calV, Trace: buildTrace(traceV), Mode: modeOf(s.Mode)})
			subCount++
		}
		ticks = append(ticks, orch.TickBlock{Tick: tk, Submissions: subs})
	}

	tr, nerr := orch.Run(&orch.Program{GenesisState: genesis, Ticks: ticks})
	if nerr != nil {
		fail("Go node run: %s/%s", nerr.Code, nerr.Detail)
	}

	// --- compare every root against the TS-pinned expectation ---
	divergences := 0
	report := func(what string, got, want string) {
		if got != want {
			divergences++
			if divergences <= 10 {
				fmt.Printf("  ❌ %s\n       Go   %s\n       TS   %s\n", what, got, want)
			}
		}
	}

	if len(tr.Ticks) != len(doc.Expected.Ticks) {
		fail("tick count: Go %d, TS %d", len(tr.Ticks), len(doc.Expected.Ticks))
	}
	for i, tk := range tr.Ticks {
		exp := doc.Expected.Ticks[i]
		report(fmt.Sprintf("tick %s state_root", exp.Tick), tk.StateRoot, exp.StateRoot)
		report(fmt.Sprintf("tick %s global_merkle_root", exp.Tick), tk.GlobalMerkleRoot, exp.GlobalMerkleRoot)
	}
	report("final_state_root", tr.FinalStateRoot, doc.Expected.FinalStateRoot)

	if len(tr.EventLog) != doc.Expected.EventCount {
		divergences++
		fmt.Printf("  ❌ event_count: Go %d, TS %d\n", len(tr.EventLog), doc.Expected.EventCount)
	}

	// SHA-256 over the canonical serialization of every event, in order. Matches the
	// TS digest only if the two runtimes produced byte-identical event logs.
	h := sha256.New()
	for i, ev := range tr.EventLog {
		b, e := canonical.CanonicalizeValue(ev)
		if e != nil {
			fail("serialize event %d: %v", i, e)
		}
		h.Write(b)
	}
	goSha := "0x" + hex.EncodeToString(h.Sum(nil))
	report("event_log_sha256", goSha, doc.Expected.EventLogSha256)

	ticksN := len(tr.Ticks)
	agents := 0
	if ticksN > 0 {
		agents = subCount / ticksN
	}
	fmt.Printf("\nOVT-3 continuous parity soak — GO node vs TS reference (%s)\n", path)
	fmt.Printf("  stream: %d ticks × %d agents = %d submissions, %d events\n", ticksN, agents, subCount, len(tr.EventLog))
	fmt.Printf("  final_state_root  %s\n", tr.FinalStateRoot)
	fmt.Printf("  event_log_sha256  %s\n", goSha)
	if divergences == 0 {
		fmt.Printf("\n✅ 0 DIVERGENCES — the Go node reproduces the TS reference root-for-root over the entire continuous stream (H3.2 / H3.3).\n")
		os.Exit(0)
	}
	fmt.Printf("\n❌ %d DIVERGENCE(S) — runtimes drifted under continuous load.\n", divergences)
	os.Exit(1)
}
