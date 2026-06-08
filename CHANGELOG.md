# Changelog

All notable changes to Paradigm Terra are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) under the policy in
[`docs/notes/release-governance.md`](docs/notes/release-governance.md).

**Current release: `v1.0.0`** (2026-06-09) — the inaugural cut, riding the PFC-1 freeze line. The freeze
tag (`pfcN-consensus-freeze`) and the release tag (`vX.Y.Z`) are distinct: the freeze tag marks *what was
proven*, the release tag marks *what was shipped on top of it*.

## [Unreleased]

_Nothing yet — the next change above the Freeze Surface starts here._

## [1.0.0] — 2026-06-09

The **inaugural release** on the PFC-1 freeze line (`pfc1-consensus-freeze`, frozen state `2fd4b8a`).
Authorized by the Release Authority on 2026-06-09 — decision "Approve release v1.0.0"
(`docs/notes/release-signoff-v1.0.0.md`); notes `docs/notes/release-notes-v1.0.0.md`. Everything below is
above the Freeze Surface; the `freeze-gate` (`vectors-check` + `verify-proof-ts` + `verify-proof-go`)
stayed green throughout, so the frozen consensus core is byte-identical to the freeze line.

### Added — Track A (Launch Readiness)
- **Release Governance** (`docs/notes/release-governance.md`) — SemVer policy, freeze lines,
  freeze-adjacent process, release authority, support policy, emergency response, auditability. The
  governance half of the Release Gate.
- **CI + Release Gate** (`.github/workflows/ci.yml`, `docs/notes/release-gate.md`) — GitHub Actions as a
  thin wrapper over `make → scripts/repro.sh`; the runnable readiness checklist; the `freeze-gate` job
  as the mechanical Freeze-Surface discriminator. First CI run caught a stale test bench (test-only fix
  `e731e07`), recorded as the first CI finding. Second CI finding: the optional `rust-parity` job is RED
  on the runner for environmental reasons (no musl/`rust-lld` build setup) while local `parity-rs` is
  green across all eight crates on `6ad02a0` — TS == Rust parity holds; not a blocker.
- **Track A charter** (`docs/notes/track-a-charter.md`) — scope, stages (A1 governance / A2 front door /
  A3 release notes / A4 sign-off + cut / A5 CI-gate), and the Definition of Done for a *declared*
  release.
- **Public front door** — `SECURITY.md` (private disclosure routed to Emergency Response),
  `CONTRIBUTING.md` (the Freeze-Surface vs operational split, the L1→L2→L3→Track A merge stack,
  cross-language parity rules), and this `CHANGELOG.md`.
- **Release notes for `v1.0.0`** (`docs/notes/release-notes-v1.0.0.md`, **DRAFT**) — the prepared tag
  annotation: SemVer rationale (inaugural release on a freeze line ⇒ 1.0.0), contents, validation
  evidence, scope/limits. Pending the governed sign-off before the tag is cut.

### Added — PR-1 (Production Readiness, CLOSED 2026-06-08)
- Long-running **daemon** over `OvtNode`: clock-driven ticks, async mempool, lifecycle; incremental
  `apply` for runtime and `recover = snapshot + tail replay` for cold recovery within the PR-1.3
  recovery SLA at 1M+ CALs.
- **Observability stack:** metrics → monitoring/drift-watch (TS↔Go on the live stream) → alerting
  (FIRING→RESOLVED), verified **backup/restore** round-trip to an identical `STATE_ROOT`, a **live
  external observer** (H3.5-live), and a **soak** readiness gate (zero root drift, zero Freeze-Surface
  defect). Evidence: `docs/notes/pr1-closure-report.md`.

### Validated
- **PP#2** (2026-06-06, ton-testnet) — verdict `A.SUCCESS`, tx `8d4b96e6…`, on-chain effect == CAL
  `wallet.send_ton` (faithful self / 50000000). Integration Reality Risk for `send_ton` confirmed live;
  the freeze stands. `docs/notes/proof-package-2-spec.md`.

## Milestone — PFC-1 Consensus Freeze — 2026-06-06

Not a release; a freeze of the **consensus core** (tag `pfc1-consensus-freeze`, frozen state `2fd4b8a`).
Canonical encoding v1.3, DSL, the full CAL pipeline (skeleton + reducer + gas + validator), the
orchestrator, the MCP schema-hash pin, TON Connect owner-sig ingress, and the TC v2 signature-verify
package — all with **NORMATIVE** golden vectors reproduced byte-for-byte across TypeScript, Rust, and
Go, and across the entire Operational Validation Track (OVT-1/2/3 + griefing) **no Freeze Surface defect
was found**. Inventory: `docs/spec/freeze-manifest-pfc1.md`; ruling: `docs/notes/pfc1-status-review.md §0`.
This is a freeze of the consensus core — **not** a statement of mainnet / launch / product readiness.

[Unreleased]: https://github.com/ooopalladiumsb/paradigm-terra/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ooopalladiumsb/paradigm-terra/compare/pfc1-consensus-freeze...v1.0.0
