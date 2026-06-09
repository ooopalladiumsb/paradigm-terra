// Verify Proof Package #1 (Gate #4) through the GO node — the cross-language reference proof.
// Mirrors orchestrator/scripts/verify-proof.mjs: reads docs/proofs/proof-package-1.json and
// re-derives it from its OWN contents through the live Go code, proving the Gate #4 contour holds
// in a second independent runtime (closes "Go reference proof = ?"; the Rust node stays
// deferred-by-constraint — no Ed25519 without a build script).
//
//	CGO_ENABLED=0 go run ./cmd/verifyproof [path-to-proof.json]   # from orchestrator-go/
//
// Checks: recompute cal_hash; re-run VerifyIngress over the stored REAL signatures (owner_sig vs
// THIS cal's canonical bytes — a pass proves the wallet signed exactly this CAL); negative control
// (tamper one owner_sig byte → OwnerSigPresent=false); re-fold the live node (validate→reduce) to
// FINALIZED with the stored event sequence / state roots / event-log Merkle root. Exit 0 iff all
// pass, AND the Go-computed cal_hash + roots equal the TS-produced values stored in the package
// (cross-language byte parity on a live signed-CAL run, not just on golden vectors).
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"

	calgo "github.com/paradigm-terra/cal-go"
	calreducer "github.com/paradigm-terra/cal-reducer-go"
	calvalidator "github.com/paradigm-terra/cal-validator-go"
	canonical "github.com/paradigm-terra/canonical-go"
	orch "github.com/paradigm-terra/orchestrator-go"
)

// jsonToCanonical converts a UseNumber-decoded JSON tree to a canonical.Value.
// The CAL carries only integers (no floats), so every json.Number becomes a canonical.Int.
func jsonToCanonical(v interface{}) canonical.Value {
	switch x := v.(type) {
	case nil:
		return nil
	case bool:
		return x
	case string:
		return x
	case json.Number:
		return canonical.Int(x.String())
	case []interface{}:
		items := make([]canonical.Value, len(x))
		for i, e := range x {
			items[i] = jsonToCanonical(e)
		}
		return canonical.A(items...)
	case map[string]interface{}:
		pairs := make([]canonical.Pair, 0, len(x))
		for k, e := range x {
			pairs = append(pairs, canonical.P(k, jsonToCanonical(e)))
		}
		return canonical.O(pairs...)
	}
	panic(fmt.Sprintf("jsonToCanonical: unhandled %T", v))
}

func hexStr(b [32]byte) string { return "0x" + hex.EncodeToString(b[:]) }

func mustStr(m map[string]interface{}, k string) string { s, _ := m[k].(string); return s }

func main() {
	path := "../docs/proofs/proof-package-1.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read %s: %v\n", path, err)
		os.Exit(1)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var j map[string]interface{}
	if err := dec.Decode(&j); err != nil {
		fmt.Fprintf(os.Stderr, "parse: %v\n", err)
		os.Exit(1)
	}

	type chk struct {
		name   string
		ok     bool
		detail string
	}
	var checks []chk
	add := func(name string, ok bool, detail string) { checks = append(checks, chk{name, ok, detail}) }

	// Reconstruct the CAL (without signatures) as a canonical.Value.
	calObj := jsonToCanonical(j["cal"]).(*canonical.Object)

	sigs := j["signatures"].(map[string]interface{})
	ownerEnv := sigs["owner_sig"].(map[string]interface{})
	tsNum := ownerEnv["timestamp"].(json.Number)
	wcNum := ownerEnv["workchain"].(json.Number)

	buildSigned := func(ownerSigHex string) canonical.Value {
		pairs := make([]canonical.Pair, 0)
		for _, k := range calObj.Keys() {
			v, _ := calObj.Get(k)
			pairs = append(pairs, canonical.P(k, v))
		}
		ownerObj := canonical.O(
			canonical.P("signature", ownerSigHex),
			canonical.P("domain", mustStr(ownerEnv, "domain")),
			canonical.P("timestamp", canonical.Int(tsNum.String())),
			canonical.P("workchain", canonical.Int(wcNum.String())),
			canonical.P("address_hash", mustStr(ownerEnv, "address_hash")),
		)
		sigObj := canonical.O(
			canonical.P("operator_sig", sigs["operator_sig"].(string)),
			canonical.P("owner_sig", ownerObj),
		)
		pairs = append(pairs, canonical.P("signatures", sigObj))
		return canonical.O(pairs...)
	}

	opPub := mustStr(j, "operator_pubkey")
	ownerPub := mustStr(j, "owner_pubkey")
	signedCal := buildSigned(mustStr(ownerEnv, "signature"))

	// 1. cal_hash (Go-computed) == stored (TS-produced)
	h, herr := calgo.CalHash(signedCal)
	got := hexStr(h)
	add("cal_hash matches (Go == stored TS)", herr == nil && got == mustStr(j, "cal_hash"), got)

	// 2. ingress crypto over the REAL signatures
	v := orch.VerifyIngress(signedCal, opPub, ownerPub)
	iv := j["ingress_verdict"].(map[string]interface{})
	add("operator_sig verifies (raw Ed25519 over canonical_bytes)", v.OperatorSigPresent, "")
	add("owner_sig verifies (Contract A over THIS cal — real wallet capture)", v.OwnerSigPresent, "")
	add("ingress verdict matches stored", v.OperatorSigPresent == iv["operatorSigPresent"] && v.OwnerSigPresent == iv["ownerSigPresent"], "")

	// Negative control: flip a byte of the owner signature → OwnerSigPresent MUST go false.
	osig := mustStr(ownerEnv, "signature")
	flip := "00"
	if osig[2:4] == "00" {
		flip = "ff"
	}
	tampered := "0x" + flip + osig[4:]
	negV := orch.VerifyIngress(buildSigned(tampered), opPub, ownerPub)
	add("negative control: tampered owner_sig → false", !negV.OwnerSigPresent, "")

	// 3. live Go node fold (validate → reduce) → FINALIZED + matching roots
	agentID := mustStr(j, "agent_id")
	g0 := calreducer.Genesis().(*canonical.Object)
	get := func(k string) canonical.Value { val, _ := g0.Get(k); return val }
	reg0 := get("registry").(*canonical.Object)
	mcpHash, _ := reg0.Get("mcp_schema_hash")
	funded := canonical.O(
		canonical.P("cal", get("cal")),
		canonical.P("failure_mode", get("failure_mode")),
		canonical.P("governance", get("governance")),
		canonical.P("oracles", get("oracles")),
		canonical.P("ptra", canonical.O(canonical.P("balances", canonical.O(canonical.P(agentID, canonical.Int("1000000000000000000")))))),
		canonical.P("registry", canonical.O(
			canonical.P("agents", canonical.O(canonical.P(agentID, canonical.O(
				canonical.P("granted_scopes", canonical.A("ton_transfer")),
				canonical.P("operator_pubkey", opPub),
				canonical.P("owner_pubkey", ownerPub),
			)))),
			canonical.P("mcp_schema_hash", mcpHash),
		)),
		canonical.P("tick", get("tick")),
		canonical.P("treasury", get("treasury")),
	)

	trace := calvalidator.ExecutionTrace{
		CurrentTick:        big.NewInt(0),
		Steps:              []calvalidator.StepResult{{OK: true}},
		StateBefore:        canonical.O(),
		StateAfter:         canonical.O(),
		OperatorSigPresent: v.OperatorSigPresent,
		OwnerSigPresent:    v.OwnerSigPresent,
	}
	prog := &orch.Program{
		GenesisState: funded,
		Ticks:        []orch.TickBlock{{Tick: big.NewInt(0), Submissions: []orch.Submission{{Cal: signedCal, Trace: trace, Mode: orch.ModeAtomic}}}},
	}
	t, nerr := orch.Run(prog)
	if nerr != nil {
		fmt.Fprintf(os.Stderr, "run: %s/%s\n", nerr.Code, nerr.Detail)
		os.Exit(1)
	}
	sub := t.Ticks[0].Submissions[0]
	fin := j["finalized_observation"].(map[string]interface{})

	stage := ""
	if sub.TerminalStage != nil {
		stage = *sub.TerminalStage
	}
	add("terminal stage FINALIZED", stage == "FINALIZED", stage)

	expEvents := j["validator_observation"].(map[string]interface{})["events"].([]interface{})
	expTypes := make([]string, len(expEvents))
	for i, e := range expEvents {
		expTypes[i] = e.(map[string]interface{})["event_type"].(string)
	}
	add("event sequence matches", strings.Join(sub.EventTypes, "→") == strings.Join(expTypes, "→"), strings.Join(sub.EventTypes, "→"))

	rootBefore, rootAfter := "", ""
	if len(sub.StateRoots) > 0 {
		rootBefore = sub.StateRoots[0]
		rootAfter = sub.StateRoots[len(sub.StateRoots)-1]
	}
	add("state_root_before matches (Go == stored TS)", rootBefore == mustStr(fin, "state_root_before"), rootBefore)
	add("state_root_after matches (Go == stored TS)", rootAfter == mustStr(fin, "state_root_after"), rootAfter)
	add("event_log Merkle root matches (Go == stored TS)", t.Ticks[0].GlobalMerkleRoot == mustStr(fin, "event_log_root"), t.Ticks[0].GlobalMerkleRoot)

	fmt.Printf("\nProof Package #1 verification — GO node (%s, status %v)\n\n", path, j["status"])
	allOk := true
	for _, c := range checks {
		mark := "✅"
		if !c.ok {
			mark = "❌"
			allOk = false
		}
		extra := ""
		if c.detail != "" {
			extra = "  — " + c.detail
		}
		fmt.Printf("  %s %s%s\n", mark, c.name, extra)
	}
	if allOk {
		fmt.Println("\n✅ ALL CHECKS PASS — the LIVE package reproduces FINALIZED through the Go node (cross-language parity on a real signed-CAL run).")
		os.Exit(0)
	}
	fmt.Println("\n❌ VERIFICATION FAILED")
	os.Exit(1)
}
