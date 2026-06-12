# Changelog

All notable changes to Paradigm Terra are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) under the policy in
[`docs/notes/release-governance.md`](docs/notes/release-governance.md).

**Current release: `v2.0.0`** (2026-06-12) — the **Multisig v2.1** MAJOR on a NEW freeze line
(`pfc2-consensus-freeze`, ruled 2026-06-12). The authorization model moved (single-owner gate → M-of-N
quorum), so this is the first release that does NOT ride the PFC-1 line. The freeze tag marks *what was
proven*; the release tag marks *what was shipped on top of it*.

## [Unreleased]

_Nothing yet — the next change above the Freeze Surface starts here._

## [2.0.0] — 2026-06-12

The **Multisig v2.1** release (PFC-2). **MAJOR**: a real authorization-model change on a **new freeze line**
(`pfc2-consensus-freeze`, ruled 2026-06-12, `docs/notes/pfc2-consensus-freeze-draft.md`). PFC-1 (v1.x)
stands unchanged beneath it; v2.0.0 is its own self-consistent freeze with regenerated evidence.

### Changed — the Tier-C surface that moved (deliberately re-frozen vs PFC-1)
- **Validator §8.2** — the single-owner gate becomes an **M-of-N quorum** (`QUORUM_NOT_MET` /
  `INVALID_SIGNATURE_SET`), pure over `ownerSigners` (M2).
- **Registry** — `owner_pubkey` → `owners[] + threshold`; v1→1-of-1 migration; §1.1 bounds; `BAD_OWNER_RECORD` (M3).
- **Gas §9.2** — `+ ownerAuthUnits(k)` on owner-required actions, linear in verified signatures; the
  operator path stays **byte-identical** to v1 (M4).
- **Golden vectors** — `validator/vectors/golden.json` re-promoted NORMATIVE: 30 vectors, TS == Rust == Go
  byte-for-byte (M5/M6/M7), incl. SC-4 `migrated 1-of-1 == v1` behaviour-identity.

### Added — PP#4-B (the on-chain authorization-envelope demonstration)
- **Offline proof** (M8-R1): quorum 2-of-3 → FINALIZED + anchor; sub-threshold 1-of-3 → `QUORUM_NOT_MET`,
  with real Ed25519 envelopes (`orchestrator/test/pp4-multisig-anchor.test.ts`).
- **Pinned anchor transport** (`pp2/src/anchor-body.ts`): typed cell `op (ANCHOR_OP 0x50544131 "PTA1") ||
  state_root:bits256`; determinism + round-trip pinned (`pp2/test/pp4-anchor-body.test.ts`).
- **PP#4-B SETTLED** live on ton-testnet: tx `7aaabb93…`, on-chain body byte-identical to the pinned anchor
  cell (root `0x4a14…d4f0`), SC-1…SC-5 all pass (`pp2/artifacts/pp4/pp4b-evidence.json`).

### Unchanged from PFC-1 (explicitly out of PFC-2)
- Operator signature model (one `operator_sig`, raw Ed25519); non-owner-gated actions (byte-identical gas
  + verdict to v1); canonical/dsl/cal/reducer core beyond the `owners[]` record + quorum gate; jetton/nft
  (Tier-M, shipped v1.1.0).

## [1.1.0] — 2026-06-10

The **jetton publication release** (J1 track), riding the unchanged PFC-1 freeze line
(`pfc1-consensus-freeze`). MINOR: a new operational capability above the Freeze Surface — the
`freeze-gate` stayed **byte-identical** throughout, so the frozen consensus core is unchanged.

Key finding (`docs/notes/pfc2-jetton-reclassification.md`): `wallet.send_jetton` was assumed Tier C (a new
freeze line, PFC-2) but **already finalizes through the frozen consensus** (registered in §2.3 with the
frozen `jetton_access` scope; generic validator/reducer/gas). So jetton is a **Tier-M publication feature**
— the only missing piece was the publication codec (§8.3, outside the freeze). PFC-2 (a *real* new freeze
line) is reserved for Multisig v2.1.

### Added — J1 (`wallet.send_jetton` publication path)
- **J1-A — publication codec** (`orchestrator/src/w5/canonical-to-inner.ts`): `encodeSendJetton` emits the
  TEP-74 `transfer` body (op `0x0f8a7ea5`), with the ⊆ rule on both the jetton amount and the attached TON,
  the D4 normalization defaults, and required-explicit `query_id` (never auto-generated).
- **J1-B — `ir_to_boc` jetton** (`pp2/src/ir-to-boc.ts`): TEP-74 transfer-body cell codec + offline
  round-trip (IR == IR'). New `pp2` CI job.
- **J1-C — Proof Package #3** (live, ton-testnet): deployed the official standard jetton (vendored
  `ton-blockchain/token-contract`, compiled with pinned func-js), minted, and drove OUR `send_jetton`
  end-to-end — recipient jetton balance `0 → 250`, operator `1000 → 750` (⊆ exact). Settlement recorded +
  correlated in the M2 reconciliation registry. Verdict **SETTLED** (`pp2/artifacts/pp3/pp3b-evidence.json`,
  `docs/notes/pp3-b-gate.md`). Pre-validated offline against the real jetton in `@ton/sandbox`.

### Notes
- Semantics: `docs/notes/pfc2-1-send-jetton-semantics.md`. Out of scope (Non-goals): nft, multisig, SBT,
  jetton mint/burn, jetton admin, `custom_payload`/`forward_payload`.
- The base CAL authorization model is unchanged; this is purely the §8.3 publication layer.

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
