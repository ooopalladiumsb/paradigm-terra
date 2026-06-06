#!/usr/bin/env bash
# Paradigm Terra — clean-room bootstrap (reproducibility hardening, H3.5 precursor).
# Installs + builds the TypeScript reference packages in DEPENDENCY ORDER. This order is
# mandatory: every package depends on its predecessors via `file:` links that resolve to the
# predecessor's built `./dist`, so a dependant cannot install/typecheck until its deps are built.
# Rust (cargo) and Go (go test) need no pre-build. After this, `scripts/repro.sh <target>` runs.
#
#   scripts/repro.sh setup        # (front-end) or: bash scripts/setup.sh
#
# Validated toolchain (see docs/notes/reproducibility-guide.md): Node 22.x (engines: >=22),
# Go 1.26.x (go.mod), tsx ~4.22. Network is required once, for the registry devDeps (tsx,
# typescript, @types/node); the cross-package deps are local `file:` links.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Topological order: each builds before anything that depends on it.
TS_PKGS=(canonical dsl cal cal-reducer cal-gas validator orchestrator)

for d in "${TS_PKGS[@]}"; do
  echo "→ setup: $d (install + build)"
  (cd "$d" && npm install --silent && npm run build --silent)
done

echo "✅ TypeScript reference built in dependency order. Now run e.g.:"
echo "   scripts/repro.sh freeze-check     # deterministic-root reproduction (golden vectors + Proof Package #1, TS == Go)"
echo "   scripts/repro.sh parity           # full TS == Rust == Go parity"
