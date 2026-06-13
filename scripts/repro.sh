#!/usr/bin/env bash
# Paradigm Terra — PFC-1 reproducibility command set (portable, no `make` required).
# A reviewer should reproduce the freeze-candidate status WITHOUT knowing project history.
# See docs/spec/freeze-manifest-pfc1.md for what these checks are evidence FOR.
#
#   scripts/repro.sh freeze-check     # fast gate: vectors NORMATIVE + both proof verifiers pass
#   scripts/repro.sh verify-proof     # Gate #4 — re-derive Proof Package #1 via TS and Go nodes
#   scripts/repro.sh parity           # full cross-language parity: TS == Rust == Go (all layers)
#   scripts/repro.sh vectors-check    # assert every golden vector + tc-v2 manifest is NORMATIVE
#   scripts/repro.sh bench            # Gate #2 — ns/op baseline harnesses (advisory, §C.4)
#   scripts/repro.sh ovt1             # OVT-1 — MCP executor (H1.1-H1.3) + autonomous agent loop (H1.4)
#   scripts/repro.sh ovt2             # OVT-2 — node as a process: crash → replay → same STATE_ROOT
#   scripts/repro.sh ovt-sg           # OVT-SG — state-growth / recovery-cost curve (slow: ~9 min)
#   scripts/repro.sh ovt3-soak        # OVT-3 — continuous TS==Go parity over a long multi-agent stream
#   scripts/repro.sh ovt3-griefing    # OVT-3 — griefing/economic-bound: every attack class is bounded
#   scripts/repro.sh setup            # clean-room bootstrap: install + build TS packages in dep order
#   scripts/repro.sh typecheck        # tsc --noEmit across every TS package that defines it
#   scripts/repro.sh m2-registry      # M2-A (SC-1): reproducible Registry-reconciliation contract build + tests
#   scripts/repro.sh tolk             # L2.0: shared Tolk build harness — golden codeHash + sandbox behavior
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/go/bin:$PATH"
export CGO_ENABLED=0
NODE="${NODE:-node}"

TS_PKGS=(canonical dsl cal cal-reducer cal-gas validator orchestrator)
RS_CRATES=(canonical-rs dsl-rs cal-rs cal-reducer-rs cal-gas-rs validator-rs orchestrator-rs tc-v2-verify-rs)
GO_MODS=(canonical-go dsl-go cal-go cal-reducer-go cal-gas-go cal-validator-go orchestrator-go tc-v2-verify-go)
GOLDENS=(canonical dsl cal cal-reducer cal-gas validator orchestrator)

verify_proof_ts() { echo "→ Proof Package #1 through the TS node"; (cd orchestrator && "$NODE" --import tsx scripts/verify-proof.mjs); }
verify_proof_go() { echo "→ Proof Package #1 through the Go node (cross-language parity)"; (cd orchestrator-go && go run ./cmd/verifyproof); }
verify_proof()    { verify_proof_ts; verify_proof_go; }

typecheck() { for d in "${TS_PKGS[@]}";  do echo "→ typecheck: $d"; (cd "$d" && npm run --if-present --silent typecheck); done; echo "✅ typecheck green (all TS packages)"; }
parity_ts() { for d in "${TS_PKGS[@]}";  do echo "→ TS parity: $d";   (cd "$d" && npm test --silent); done; }
parity_rs() { for d in "${RS_CRATES[@]}"; do echo "→ Rust parity: $d"; (cd "$d" && cargo test --release --quiet); done; }
parity_go() { for d in "${GO_MODS[@]}";  do echo "→ Go parity: $d";   (cd "$d" && go test ./...); done; }
parity()    { parity_ts; parity_rs; parity_go; echo "✅ cross-language parity green (TS == Rust == Go)"; }

vectors_check() {
  local ok=1
  for d in "${GOLDENS[@]}"; do
    if grep -q '"status": "NORMATIVE' "$d/vectors/golden.json"; then echo "  ✅ $d/vectors/golden.json"; else echo "  ❌ $d NOT NORMATIVE"; ok=0; fi
  done
  if grep -q '"status": "NORMATIVE"' spec/vectors/tc_v2_sig_verify_v1/manifest.json; then echo "  ✅ tc_v2_sig_verify_v1/manifest.json"; else echo "  ❌ tc_v2 manifest NOT NORMATIVE"; ok=0; fi
  [ "$ok" -eq 1 ] && echo "✅ all normative vectors present" || { echo "❌ vector integrity failed"; exit 1; }
}

bench() {
  (cd cal-gas && "$NODE" --import tsx bench/gas-bench.mjs)
  (cd cal-gas-rs && cargo run --release --quiet --bin gas_bench)
  (cd cal-gas-go && go run ./cmd/gasbench)
}

freeze_check() { vectors_check; verify_proof; echo "✅ freeze-check passed — normative vectors intact + Gate #4 contour reproduces in TS and Go"; }

ovt1() {
  echo "→ OVT-1 (H1.1-H1.3): MCP executor generates ExecutionTrace over real MCP calls"
  (cd orchestrator && "$NODE" --import tsx scripts/ovt1-executor-proof.mjs)
  echo "→ OVT-1 (H1.4): autonomous agent loop construct→sign→execute→submit→FINALIZED"
  (cd orchestrator && "$NODE" --import tsx scripts/ovt1-agent-loop.mjs)
}

ovt2() { echo "→ OVT-2: persistent node — crash → replay → same STATE_ROOT"; (cd orchestrator && "$NODE" --import tsx scripts/ovt2-crash-replay.mjs); }

ovt_sg() { echo "→ OVT-SG: state-growth / recovery-cost curve (slow: ~9 min)"; (cd orchestrator && "$NODE" --import tsx scripts/ovt-sg-growth.mjs); }

# OVT-3 (H3.2/H3.3): generate a long multi-agent stream through the TS node, then re-fold
# the identical stream through the Go node — must reproduce every root + the event-log
# SHA-256 with 0 divergences. SOAK_TICKS / SOAK_AGENTS tune the load (defaults 120 × 40).
ovt3_soak() {
  echo "→ OVT-3: continuous parity soak — TS reference stream"
  (cd orchestrator && "$NODE" --import tsx scripts/ovt3-soak-stream.ts)
  echo "→ OVT-3: re-fold the identical stream through the Go node (0 divergences required)"
  (cd orchestrator-go && go run ./cmd/soak)
}

# OVT-3 (H3.4): flood every malformed/expensive CAL class through the node and prove the
# economics (escrow/spam-fee) + DSL structural limits bound each one. Also emits the
# empirical datum for PATH_SEGMENT_WEIGHT_REVIEW.
ovt3_griefing() { echo "→ OVT-3: griefing / economic-bound validation"; (cd orchestrator && "$NODE" --import tsx scripts/ovt3-griefing.mjs); }

# M2-A (SC-1): the Registry reconciliation contract is a NON-NORMATIVE operational artifact (Tier M,
# above the Freeze Surface). Reproducible Tolk build (pinned @ton/tolk-js) + determinism/schema tests.
# Standalone package (own node_modules, no `file:` links) — installed here, not in setup.sh's dep chain.
m2_registry() {
  echo "→ M2-A: Registry reconciliation — reproducible contract build + SC-1 tests"
  (cd m2-registry && npm install --silent && npm run build --silent && npm run typecheck --silent && npm test --silent)
}

# pp2 — publication-layer (§8.3, OUT of the freeze): ir_to_boc round-trip incl. J1-B jetton (TEP-74).
# Standalone package (own node_modules, @ton/core); offline tests only (network scripts live in pp2/scripts).
pp2() {
  echo "→ pp2: publication-layer ir_to_boc round-trip (send_ton + J1-B jetton)"
  (cd pp2 && npm install --silent && npx tsc --noEmit && npm test --silent)
}

# tolk — L2.0 shared Tolk build harness (Layer 2, Tier M, above the Freeze Surface). Reproducible
# @ton/tolk-js build → golden codeHash drift guard + @ton/sandbox behavior tests. Standalone package.
tolk() {
  echo "→ tolk: L2.0 Tolk build harness (golden codeHash + sandbox behavior)"
  (cd tolk && npm install --silent && npm run build --silent && npm run typecheck --silent && npm test --silent)
}

case "${1:-help}" in
  setup)           bash "$ROOT/scripts/setup.sh" ;;
  typecheck)       typecheck ;;
  verify-proof-ts) verify_proof_ts ;;
  verify-proof-go) verify_proof_go ;;
  verify-proof)    verify_proof ;;
  parity-ts)       parity_ts ;;
  parity-rs)       parity_rs ;;
  parity-go)       parity_go ;;
  parity)          parity ;;
  vectors-check)   vectors_check ;;
  bench)           bench ;;
  ovt1)            ovt1 ;;
  ovt2)            ovt2 ;;
  ovt-sg)          ovt_sg ;;
  ovt3-soak)       ovt3_soak ;;
  ovt3-griefing)   ovt3_griefing ;;
  m2-registry)     m2_registry ;;
  pp2)             pp2 ;;
  tolk)            tolk ;;
  freeze-check)    freeze_check ;;
  help|*)          grep -E '^#   scripts/repro.sh ' "$0" | sed 's/^#   /  /' ;;
esac
