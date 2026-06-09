// Gate #2 — Go ns/op benchmark harness (per docs/notes/gate2-benchmark-plan.md).
//
// MEASURE, do not optimize. Median ns/op per gas-priced operation class + ratio to the
// DSL-binary-op peg, checked against [0.5x, 2.0x] of each class's abstract weight. Out-of-band
// cells are FLAGGED as Tier-2 candidates — nothing is tuned here.
//
//	CGO_ENABLED=0 go run ./cmd/gasbench        # from cal-gas-go/
//
// Measures the per-op EVALUATION traversal cost: dsl.Evaluate(ast, bindings, scope) with the AST
// parsed ONCE outside the timed loop, so fixed parse cost cannot swamp the marginal per-op cost
// and compress every ratio toward 1. MCP / state-rent classes time their cal-gas primitives
// directly. Results accumulate into `sink` (printed) to deter dead-code elimination. ns/op is
// machine-relative; the RATIO to the peg is the portable signal. Mirrors cal-gas/bench/gas-bench.mjs.
package main

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	calgas "github.com/paradigm-terra/cal-gas-go"
	canonical "github.com/paradigm-terra/canonical-go"
	dsl "github.com/paradigm-terra/dsl-go"
)

var sink int // consumed to deter DCE

func jcs(s string) canonical.Value {
	v, err := canonical.ParseCanonical(s)
	if err != nil {
		panic(fmt.Sprintf("canonical parse %q: %v", s, err))
	}
	return v
}

func parse(src string, scope dsl.Scope) *dsl.Expr {
	e, derr := dsl.ParseExpression(jcs(src), scope, dsl.V12)
	if derr != nil {
		panic(fmt.Sprintf("parse %q: %s/%s", src, derr.Phase.Code(), derr.Reason))
	}
	return e
}

// median ns/op: warmup, then `batches` batches of `inner` reps; ns/op = batchNs/inner; median.
func bench(f func(), warmup, batches, inner int) float64 {
	for i := 0; i < warmup; i++ {
		f()
	}
	samples := make([]float64, batches)
	for j := 0; j < batches; j++ {
		t0 := time.Now()
		for i := 0; i < inner; i++ {
			f()
		}
		samples[j] = float64(time.Since(t0).Nanoseconds()) / float64(inner)
	}
	sort.Float64s(samples)
	return samples[batches/2]
}

type row struct {
	cls       string
	ns        float64
	weight    float64
	synthetic bool
	note      string
}

func main() {
	pre := dsl.ScopePrecondition

	stateBind := dsl.BindingsFromJcs(jcs(`{"state":{"a":{"b":{"c":{"d":{"e":1}}}},"arr":[1,2,3],"m":{"k":1},"x":1}}`))
	invBind := dsl.BindingsFromJcs(jcs(`{"after":{"x":1},"before":{"x":1}}`))
	empty := dsl.BindingsFromJcs(jcs(`{}`))

	pegAst := parse(`{"lhs":{"const":1},"op":"eq","rhs":{"const":1}}`, pre)
	ckAst := parse(`{"lhs":{"var":"state.m"},"op":"contains_key","rhs":{"const":"k"}}`, pre)
	sizeAst := parse(`{"lhs":{"arg":{"var":"state.arr"},"op":"size"},"op":"gte","rhs":{"const":0}}`, pre)
	gateAst := parse(`{"args":[{"const":"treasury.transfer"}],"op":"is_owner_required"}`, dsl.ScopeGate)
	invAst := parse(`{"lhs":{"var":"state.after.x"},"op":"gte","rhs":{"const":0}}`, dsl.ScopeInvariant)
	shallowAst := parse(`{"lhs":{"var":"state.x"},"op":"eq","rhs":{"const":1}}`, pre)        // 2 segs
	deepAst := parse(`{"lhs":{"var":"state.a.b.c.d.e"},"op":"eq","rhs":{"const":1}}`, pre) // 6 segs

	// self-check: every parsed expression must evaluate cleanly.
	checks := []struct {
		name string
		oc   dsl.Outcome
	}{
		{"peg", dsl.Evaluate(pegAst, empty, pre)},
		{"contains_key", dsl.Evaluate(ckAst, stateBind, pre)},
		{"size", dsl.Evaluate(sizeAst, stateBind, pre)},
		{"gate", dsl.Evaluate(gateAst, stateBind, dsl.ScopeGate)},
		{"invariant", dsl.Evaluate(invAst, invBind, dsl.ScopeInvariant)},
		{"shallow", dsl.Evaluate(shallowAst, stateBind, pre)},
		{"deep", dsl.Evaluate(deepAst, stateBind, pre)},
	}
	for _, c := range checks {
		if c.oc.Code != "EVALUATION_TRUE" && c.oc.Code != "EVALUATION_FALSE" {
			fmt.Fprintf(os.Stderr, "SELF-CHECK FAILED: %s: %s/%s\n", c.name, c.oc.Code, c.oc.Reason)
			os.Exit(1)
		}
	}

	kib := jcs(fmt.Sprintf(`[{"ns":"ptra","op":"set","path":"state.ptra.balances.x","value":"0x%s"}]`, strings.Repeat("ab", 496)))

	w, b, in := 2000, 99, 1000
	peg := bench(func() { sink += len(dsl.Evaluate(pegAst, empty, pre).Code) }, w, b, in)
	nsShallow := bench(func() { sink += len(dsl.Evaluate(shallowAst, stateBind, pre).Code) }, w, b, in)
	nsDeep := bench(func() { sink += len(dsl.Evaluate(deepAst, stateBind, pre).Code) }, w, b, in)
	nsPerSeg := (nsDeep - nsShallow) / 4.0 // 6 - 2 = 4 extra segments

	nsGate := bench(func() { sink += len(dsl.Evaluate(gateAst, stateBind, dsl.ScopeGate).Code) }, w, b, in)
	nsCk := bench(func() { sink += len(dsl.Evaluate(ckAst, stateBind, pre).Code) }, w, b, in)
	nsSize := bench(func() { sink += len(dsl.Evaluate(sizeAst, stateBind, pre).Code) }, w, b, in)
	nsInv := bench(func() { sink += len(dsl.Evaluate(invAst, invBind, dsl.ScopeInvariant).Code) }, w, b, in)
	nsMcpR := bench(func() { sink += int(calgas.MCPCallUnits("agent.get_balance").Int64()) }, w, b, in)
	nsMcpW := bench(func() { sink += int(calgas.MCPCallUnits("agent.transfer").Int64()) }, w, b, in)
	bn, _ := calgas.EffectsBytes(kib)
	bytes := float64(bn.Int64())
	nsEncode := bench(func() { x, _ := calgas.EffectsBytes(kib); sink += int(x.Int64()) }, w, b, 200)
	nsByte := nsEncode / bytes

	rows := []row{
		{"binary op (peg)", peg, 1, false, "eq(const,const)"},
		{"path segment", nsPerSeg, 2, false, "slope: var(6seg)-var(2seg) /4"},
		{"gate op", nsGate, 5, false, "is_owner_required(const) @gate"},
		{"contains_key", nsCk, 10, false, "contains_key(var,const)"},
		{"size", nsSize, 20, false, "gte(size(var),0)"},
		{"invariant base", nsInv, 5, false, "gte(var(after.x),0) @invariant"},
		{"mcp read (synthetic)", nsMcpR, 50, true, "MCPCallUnits"},
		{"mcp write (synthetic)", nsMcpW, 200, true, "MCPCallUnits"},
		{"state-rent / byte", nsByte, 1, false, "EffectsBytes / bytes"},
	}

	fmt.Printf("\nGate #2 — Go ns/op baseline (peg = binary op = %.0f ns/op, %d effect bytes)\n\n", peg, int(bytes))
	fmt.Println("| class | ns/op | ratio | weight | band | status | op |")
	fmt.Println("|---|--:|--:|--:|---|---|---|")
	var outs []string
	for _, r := range rows {
		ratio := r.ns / peg
		lo, hi := 0.5*r.weight, 2.0*r.weight
		band, mark := "—", "peg"
		if r.cls != "binary op (peg)" {
			band = fmt.Sprintf("[%g, %g]", lo, hi)
			if r.synthetic {
				mark = "SYNTH"
			} else if ratio >= lo && ratio <= hi {
				mark = "IN"
			} else {
				mark = "OUT"
				outs = append(outs, r.cls)
			}
		}
		nsStr := fmt.Sprintf("%.2f", r.ns)
		if r.ns >= 100 || r.ns <= -100 {
			nsStr = fmt.Sprintf("%.0f", r.ns)
		}
		fmt.Printf("| %s | %s | %.2f | %g | %s | %s | %s |\n", r.cls, nsStr, ratio, r.weight, band, mark, r.note)
	}
	if len(outs) == 0 {
		fmt.Println("\n✅ all measurable cells IN band")
	} else {
		fmt.Printf("\n⚠ OUT-of-band (Tier-2 candidates, NOT to fix here): %s\n", strings.Join(outs, ", "))
	}
	fmt.Println("(synthetic rows: MCP — validator-side CPU is verb classification only; real MCP cost is off-chain.)")
	fmt.Fprintf(os.Stderr, "sink=%d\n", sink)
}
