# Release Sign-off Record — v1.0.0 (SIGNED — release approved)

> **Status: SIGNED — APPROVED.** Authorized by the Release Authority (ooopalladiumsb) on **2026-06-09**
> with the decision "Approve release v1.0.0". The annotated tag `v1.0.0` was cut on the release commit
> below; `release-notes-v1.0.0.md` was promoted from DRAFT. This record satisfies
> `release-governance.md §Release Authority`: green required CI is necessary but not sufficient — this
> sign-off is the assertion of *intent to ship* and acceptance of the support obligations.

## 1. Commit identifiers

| | Value |
|---|---|
| **Release commit** | the commit tagged **`v1.0.0`** on `track-a/launch-readiness` — the signing commit carrying this record. Recover with `git rev-parse v1.0.0^{commit}`. |
| **Freeze line** | `pfc1-consensus-freeze` @ `54e1864` (frozen state `2fd4b8a`) |
| **Tag cut** | `v1.0.0` (annotated; annotation = `docs/notes/release-notes-v1.0.0.md`) |

The release tag and the freeze tag are distinct by policy: the freeze tag marks *what was proven*, the
release tag marks *what is shipped on top of it*.

## 2. Readiness gate (must all hold on the release commit)

Per `release-governance.md §Release Readiness Requirements`. Confirm each on the release commit before signing:

- [x] **CI green** — required jobs `ts-ops`, `freeze-gate`, `go-parity` pass; verified on the release
      commit via the authoritative `scripts/repro.sh` that CI wraps (`freeze-check` + `parity`, all
      green). `rust-parity` is optional and environmental-RED on the runner (confirmed green locally —
      `release-gate.md §CI findings`).
- [x] **Freeze Gate green** — `freeze-gate` (`vectors-check` + `verify-proof-ts` + `verify-proof-go`):
      vectors NORMATIVE + Proof Package #1 reproduces in TS and Go. Verified via `make freeze-check`.
- [x] **PP#2 complete** — testnet tx `8d4b96e6…`, on-chain effect == CAL `wallet.send_ton`
      (`docs/notes/proof-package-2-spec.md`).
- [x] **H3.5 complete** — offline + live re-derivation (`docs/notes/reproducibility-guide.md §6`; PR-1.8
      live observer).
- [x] **PR-1 complete** — operational kernel merged and validated (`docs/notes/pr1-closure-report.md`).
- [x] **Closure Report current** — `pr1-closure-report.md` (PR-1 CLOSED 2026-06-08) is the current
      Production-Readiness evidence; its scope is unchanged by the Track A docs-only commits that ride
      above it.

(All boxes confirmed on the release commit at sign-off time. The Freeze Surface is byte-identical to the
freeze line — every Track A commit is above it; `freeze-gate` green proves it.)

## 3. Validation artifacts

| Evidence | Artifact |
|---|---|
| Freeze ruling + inventory | `docs/notes/pfc1-status-review.md §0` · `docs/spec/freeze-manifest-pfc1.md` |
| Proof Package #1 | `docs/proofs/proof-package-1.json` (status `LIVE`) |
| PP#2 (ton-testnet, `A.SUCCESS`) | `docs/notes/proof-package-2-spec.md` (tx `8d4b96e6…`) |
| H3.5 (offline + live) | `docs/notes/reproducibility-guide.md §6` · PR-1.8 live observer |
| OVT (no Freeze Surface defect) | `docs/notes/operational-validation-track.md` · `pfc1-status-review.md §0` |
| PR-1 closure | `docs/notes/pr1-closure-report.md` |

## 4. Closure reports at the release commit

- `docs/notes/pr1-closure-report.md` — Production-Readiness evidence (PR-1 CLOSED 2026-06-08).
- _(any successor closure report at the release commit, if added)_

## 5. Release notes

`docs/notes/release-notes-v1.0.0.md` — names the freeze line (`pfc1-consensus-freeze`) and the SemVer
bump rationale (inaugural release on a freeze line ⇒ MAJOR `1.0.0`). Must be promoted from DRAFT and its
"Release commit" line pinned before the tag is cut.

## 6. Decision

By signing, I assert that the readiness gate (§2) holds on the named release commit, accept the support
obligations of `release-governance.md §Support Policy` (only the current freeze line is supported), and
authorize cutting the annotated `v1.0.0` tag on that commit.

| Field | Value |
|---|---|
| Release commit (pinned) | the commit tagged `v1.0.0` (`git rev-parse v1.0.0^{commit}`) — the signing commit carrying this record |
| CI run (green) | required gate verified locally via `scripts/repro.sh freeze-check` + `parity` (the targets CI wraps); PR #4 runner re-runs on push |
| Decision | ☑ **APPROVED — release** |
| Authority (name / role) | **ooopalladiumsb** — Release Authority |
| Date | **2026-06-09** |

Decision of record: **"Approve release v1.0.0."**

**Executed at sign-off:** `release-notes-v1.0.0.md` promoted from DRAFT; the annotated tag cut with
`git tag -a v1.0.0 -F docs/notes/release-notes-v1.0.0.md <release-commit>`; the tag pushed; `CHANGELOG.md`
`[Unreleased]` → `[1.0.0]` split applied.

## Related
- `release-governance.md §Release Authority` — the policy this record satisfies.
- `release-notes-v1.0.0.md` — the tag annotation (DRAFT until this is signed).
- `track-a-charter.md` — A4 (this record + the cut) is the terminal item.
- `release-gate.md` — the runnable readiness checklist behind §2.
