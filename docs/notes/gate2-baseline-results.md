# Gate #2 — ns/op baseline results (measured)

**Status:** Baseline captured 2026-06-02. Companion to the plan in
`gate2-benchmark-plan.md`. Discipline held: **MEASURE, do not optimize** — no unit
weight and no implementation was changed in response to a number. Out-of-band cells
are recorded as Tier-2-amendment candidates only.

## Conditions (reproducibility)

| | |
|---|---|
| Machine | Intel Celeron N4120 @ 1.10 GHz, 4 cores |
| OS | Linux 6.6.114.1-microsoft-standard-WSL2 |
| Commit | `3e162bd` (branch `feat/tc-v2-sig-verify-v1`) + local bench harnesses |
| TS | node v22.22.2, `node --import tsx bench/gas-bench.mjs` |
| Rust | `cargo run --release --bin gas_bench` (musl static, opt-level release) |
| Go | `CGO_ENABLED=0 go run ./cmd/gasbench` (go at `~/.local/go`) |

**Methodology.** Each operation class is exercised through `evaluate(ast, bindings,
scope)` with the AST **parsed once outside the timed loop** — the gas weights are a
proxy for evaluation-traversal work, and the fixed per-call parse cost (≈µs in TS)
would otherwise swamp the marginal per-op cost and compress every ratio toward 1.
≥2000 warmup iterations; ns/op = median over 99 batches of 1000 reps (200 for the
state-rent encode). Every result is consumed (additive sink / `black_box`) to defeat
dead-code elimination. MCP and state-rent classes time the cal-gas primitives
(`mcpCallUnits`, `effectsBytes`) directly. The **ratio to the binary-op peg** is the
portable signal; absolute ns/op is machine-relative.

`path segment` is the per-segment *marginal* (slope): `var(6 seg) − var(2 seg)` ÷ 4.

## Results (one synchronized run, 2026-06-02)

| Class | weight | band | TS ns / ratio | Rust ns / ratio | Go ns / ratio | verdict |
|---|--:|---|---|---|---|---|
| binary op (peg) | 1 | ≡1.00 | 389 / 1.00 | 253 / 1.00 | 201 / 1.00 | peg |
| path segment | 2 | [1, 4] | 93 / 0.24 | 13 / 0.05 | 92 / 0.46 | **OUT ×3** |
| gate op | 5 | [2.5, 10] | 1899 / 4.89 | 1031 / 4.08 | 1321 / 6.59 | IN ×3 |
| contains_key | 10 | [5, 20] | 1843 / 4.74 | 2167 / 8.57 | 1624 / 8.10 | TS OUT, RS/Go IN |
| size | 20 | [10, 40] | 1084 / 2.79 | 1537 / 6.08 | 3077 / 15.34 | TS/RS OUT, Go IN |
| invariant base | 5 | [2.5, 10] | 529 / 1.36 | 290 / 1.15 | 984 / 4.91 | TS/RS OUT, Go IN |
| mcp read | 50 | [25, 100] | 406 / 1.04 | 99 / 0.39 | 392 / 1.96 | synthetic (N/A) |
| mcp write | 200 | [100, 400] | 312 / 0.80 | 81 / 0.32 | 412 / 2.06 | synthetic (N/A) |
| state-rent / byte | 1 | [0.5, 2] | 252 / 0.65 | 152 / 0.60 | 102 / 0.51 | IN ×3 |

### Stability (run-to-run, observed across ≥3 invocations)

The binary-op peg carries ≈±10 % noise on this machine, which propagates to every
ratio. Classifications that straddle a band edge are noted:

- **Stable IN (all runtimes):** gate op, state-rent/byte (Go state-rent dips to ~0.45 — edge).
- **Stable OUT (all runtimes, below band):** path segment.
- **Edge-straddling:** TS `contains_key` (4.6–5.3, lower edge 5.0); Go/Rust `invariant`
  and `size` move in/out with the peg's noise and with collection size.

## Findings → Tier-2 candidates (NOT fixed here)

1. **`path_segment` weight = 2 over-prices CPU.** Out of band low in all three
   tree-walkers (0.05–0.46×). A path-segment marginal is a property lookup — cheaper
   than a binary comparison in every runtime. *This is the one systematic finding.*
   Resolution is a deferred Tier-2 decision: either lower the weight toward ~0.5–1,
   or (preferred for consensus stability) leave the count and rely on its advisory
   status per §C.4. **No change made** — parked as `PATH_SEGMENT_WEIGHT_REVIEW`
   (`tier2-path-segment-weight-review.md`), decided at quiet-period close.

2. **`size` is data-dependent (`O(n)`), measured at n=3.** The static weight 20
   anticipates larger collections; with n=3 the eval is cheap (TS 2.8×, Rust 6.1×),
   in band only in Go (15.3×, slower peg). Not a defect — a measurement-design
   caveat. A representative-collection-size benchmark is the proper Tier-2 follow-up
   if calibration is ever made normative.

3. **MCP rows are synthetic.** The validator's MCP "cost" is verb classification
   (`get_*` → 50, else 200) — a string split — not the real call, which is off-chain
   and non-deterministic (§4.1). Their CPU ratio cannot calibrate the 50/200 economic
   weights; band N/A.

## Why this does not block the freeze

§C.4 makes the wall-clock columns **advisory**: the consensus-binding artifact is the
unit **count** per operation, parity-locked by `cal-gas/vectors/golden.json` and the
cross-language diff-fuzzer (untouched here). The cost model is a semantic / anti-grief
weighting, not a CPU model, so it need not coincide with measured ns/op within 2×. The
baseline's job is to surface candidates for the Tier-2 amendment process — which it did
(`path_segment`) — not to gate the freeze.

## Harness changes (this baseline)

- `dsl-rs`: exported `evaluate(&Expr, &Bindings, Scope)` (was private; mirrors TS).
- `dsl-go`: added exported `Evaluate(*Expr, Bindings, Scope)` wrapper (mirrors TS).
- New: `cal-gas/bench/gas-bench.mjs`, `cal-gas-rs/src/bin/gas_bench.rs`,
  `cal-gas-go/cmd/gasbench/main.go`. No consensus-path code touched; all parity/golden
  vectors remain green.
