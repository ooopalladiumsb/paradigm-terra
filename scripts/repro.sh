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

case "${1:-help}" in
  verify-proof-ts) verify_proof_ts ;;
  verify-proof-go) verify_proof_go ;;
  verify-proof)    verify_proof ;;
  parity-ts)       parity_ts ;;
  parity-rs)       parity_rs ;;
  parity-go)       parity_go ;;
  parity)          parity ;;
  vectors-check)   vectors_check ;;
  bench)           bench ;;
  freeze-check)    freeze_check ;;
  help|*)          grep -E '^#   scripts/repro.sh ' "$0" | sed 's/^#   /  /' ;;
esac
