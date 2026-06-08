# Release Notes — v1.0.0

> **Status: RELEASED.** Authorized by the Release Authority on 2026-06-09 ("Approve release v1.0.0";
> sign-off record `release-signoff-v1.0.0.md §6`) and cut as the annotated tag `v1.0.0`. This is the
> inaugural release on the PFC-1 freeze line.

**Paradigm Terra v1.0.0** — the first released cut of the protocol, riding the **PFC-1 consensus freeze
line** (`pfc1-consensus-freeze`, frozen state `2fd4b8a`). The release tag and the freeze tag are
distinct: the freeze tag marks *what was proven*, this release tag marks *what is shipped on top of it*.

## SemVer rationale

**MAJOR = 1.0.0.** This is the inaugural release on a consensus freeze line — by the policy in
`release-governance.md §Versioning`, the first release on a freeze line is `1.0.0`, and any future
consensus-breaking change is a new freeze line and a new MAJOR. Everything shipped here is the
already-frozen consensus core plus the operational platform built strictly above it; nothing on the
Freeze Surface was altered to produce this release.

## What's in this release

**Frozen consensus core (PFC-1)** — NORMATIVE, reproduced byte-for-byte across TypeScript, Rust, and Go:
- Canonical Encoding v1.3, the Constraint DSL, and the full CAL pipeline (skeleton + reducer + gas +
  validator), the orchestrator/node, the MCP schema-hash pin, TON Connect owner-sig ingress, and the
  TC v2 signature-verify package.
- No Freeze Surface defect was found across the entire Operational Validation Track (OVT-1/2/3 +
  griefing). Inventory: `docs/spec/freeze-manifest-pfc1.md`; ruling: `docs/notes/pfc1-status-review.md §0`.

**Operational platform (PR-1, above the freeze)** — `docs/notes/pr1-closure-report.md`:
- Long-running daemon over `OvtNode` (clock ticks, async mempool, incremental apply,
  `recover = snapshot + tail` within the recovery SLA at 1M+ CALs);
- metrics → monitoring/drift-watch (TS↔Go live) → alerting, verified backup/restore, a live external
  observer (H3.5-live), and a soak readiness gate with **zero** root drift and **zero** Freeze-Surface defect.

**Launch readiness (Track A, above the freeze)** — release governance, the CI/Release-Gate, the public
front door (`README`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`), and this release.

## Validation evidence (rides on, does not re-prove)

| Evidence | Artifact |
|---|---|
| Freeze ruling + inventory | `docs/notes/pfc1-status-review.md §0`, `docs/spec/freeze-manifest-pfc1.md` |
| Proof Package #1 (end-to-end smoke) | `docs/proofs/proof-package-1.json` (`verify-proof-ts` + `verify-proof-go`) |
| PP#2 (testnet, A.SUCCESS, tx `8d4b96e6…`) | `docs/notes/proof-package-2-spec.md` |
| H3.5 independent reproduction (offline + live) | `docs/notes/reproducibility-guide.md §6`, PR-1.8 live observer |
| PR-1 production readiness | `docs/notes/pr1-closure-report.md` |
| NORMATIVE vectors + cross-language parity | `make vectors-check`, `make parity` |

## How to verify

```
make setup
make freeze-check     # vectors NORMATIVE + Proof Package #1 reproduces in TS and Go
make parity           # TS / Rust / Go agree byte-for-byte
```

Required CI on the release commit: `ts-ops`, `freeze-gate`, `go-parity` green (`rust-parity` optional on
this first line). See `docs/notes/release-gate.md`.

## Scope & limits (read this)

- This release ships the **proven path** — `wallet.send_ton`, confirmed live in PP#2. It is **not** a
  statement of broad mainnet/product coverage. Additional verb classes (jetton, nft, bounded-mode),
  multi-owner Multisig v2.1, the Agentic Wallet SBT TEP, and Tolk on-chain artifacts are **post-launch**
  tracks on their own lines (and any consensus expansion is a new freeze line).
- Only the **current freeze line (PFC-1)** is supported (`release-governance.md §Support Policy`). Prior
  lines remain archived and reproducible; reproducibility is permanent, maintenance is not.

## Release commit & freeze line

- **Freeze line:** `pfc1-consensus-freeze` @ `54e1864` (frozen state `2fd4b8a`).
- **Release commit:** the commit tagged **`v1.0.0`** on `track-a/launch-readiness` — the signing commit
  that carries the completed sign-off record. Recover it at any time with `git rev-parse v1.0.0^{commit}`.
  Required gate (`vectors-check` + `verify-proof-ts` + `verify-proof-go`, plus `parity`) verified green on
  this commit before tagging; optional `rust-parity` is environmental-RED on the runner (confirmed green
  locally — see `release-gate.md §CI findings`).

## Related
- `release-governance.md` — the versioning/authority/support policy this release executes against.
- `track-a-charter.md` — the launch-readiness track this release closes.
- `release-gate.md` — the runnable readiness checklist + required CI.
