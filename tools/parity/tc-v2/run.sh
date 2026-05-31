#!/usr/bin/env bash
# Cross-language parity harness for TC_V2_SIGNDATA_VERIFY_V1 (Stage 5).
#
# Runs the TS, Rust, and Go implementations against the SAME committed golden vectors
# (spec/vectors/tc_v2_sig_verify_v1/) and requires all three green.
#
# Why "all three green" == cross-language parity: every suite asserts its computed
# digests are byte-identical to the committed `digest_sha256_hex`. Because all three
# compare to the same canonical values, green-across-three transitively proves
# TS digest == Rust digest == Go digest on the whole corpus. The verdict axis
# (ed25519) is independently confirmed by TWO crypto engines: TS (Node/OpenSSL) and
# Go (pure-Go std crypto/ed25519). Rust is digest-only by design.
#
#   bash tools/parity/tc-v2/run.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$HOME/.local/go/bin:$PATH"
export CGO_ENABLED=0

fail=0
run() { # label, command...
  local label="$1"; shift
  echo "=== $label ==="
  if "$@"; then echo "  ✅ $label green"; else echo "  ❌ $label FAILED"; fail=1; fi
  echo
}

run "TS  (digest 14/14 + verdict 15/15)" node tools/tc-v2-verify/run-vectors.mjs
run "Rust (digest 14/14, no ed25519)"    bash -c 'cd tc-v2-verify-rs && cargo test --offline -q'
run "Go  (digest 14/14 + verdict 15/15)" bash -c 'cd tc-v2-verify-go && go test ./...'

if [ "$fail" -eq 0 ]; then
  echo "✅ CROSS-LANGUAGE PARITY GREEN — TS == Rust == Go on every digest; TS & Go agree on every verdict."
  echo "   Stage 5 gate met. Stage 6 (validator integration) is now unblocked."
  exit 0
else
  echo "❌ PARITY RED — do not proceed to validator integration."
  exit 1
fi
