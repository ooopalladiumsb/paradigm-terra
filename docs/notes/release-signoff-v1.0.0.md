# Release Sign-off Record — v1.0.0 (UNSIGNED — awaiting authority)

> **Status: UNSIGNED.** This is the sign-off form required by `release-governance.md §Release Authority`
> for the inaugural `v1.0.0`. The factual fields below are pre-filled and verifiable from the repository;
> the **Decision** section at the bottom is left for project governance to complete. **Until that section
> is signed and dated, v1.0.0 is NOT released and no tag may be cut** (A4). Green CI is necessary but not
> sufficient — this record is the assertion of *intent to ship* and acceptance of the support obligations.

## 1. Commit identifiers

| | Value |
|---|---|
| **Release commit** | _pin at tag time_ — the head of `track-a/launch-readiness` carrying this signed record. Candidate at drafting: `db06d51` (the signing commit will be its child). |
| **Freeze line** | `pfc1-consensus-freeze` @ `54e1864` (frozen state `2fd4b8a`) |
| **Tag to cut** | `v1.0.0` (annotated; annotation = `docs/notes/release-notes-v1.0.0.md`, promoted from DRAFT) |

The release tag and the freeze tag are distinct by policy: the freeze tag marks *what was proven*, the
release tag marks *what is shipped on top of it*.

## 2. Readiness gate (must all hold on the release commit)

Per `release-governance.md §Release Readiness Requirements`. Confirm each on the release commit before signing:

- [ ] **CI green** — required jobs `ts-ops`, `freeze-gate`, `go-parity` pass on the release commit
      (`rust-parity` optional on this first line). CI run: _link the green run_.
- [ ] **Freeze Gate green** — `freeze-gate` (`vectors-check` + `verify-proof-ts` + `verify-proof-go`):
      vectors NORMATIVE + Proof Package #1 reproduces in TS and Go. Local: `make freeze-check`.
- [x] **PP#2 complete** — testnet tx `8d4b96e6…`, on-chain effect == CAL `wallet.send_ton`
      (`docs/notes/proof-package-2-spec.md`).
- [x] **H3.5 complete** — offline + live re-derivation (`docs/notes/reproducibility-guide.md §6`; PR-1.8
      live observer).
- [x] **PR-1 complete** — operational kernel merged and validated (`docs/notes/pr1-closure-report.md`).
- [ ] **Closure Report current** — `pr1-closure-report.md`'s commit range + risk-class table match the
      release commit. Confirm at tag time.

(Checked boxes = evidence already in the repo at drafting; unchecked = must be re-confirmed on the exact
release commit, since CI and the closure-report range are commit-specific.)

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

## 6. Decision (governance completes this)

By signing, I assert that the readiness gate (§2) holds on the named release commit, accept the support
obligations of `release-governance.md §Support Policy` (only the current freeze line is supported), and
authorize cutting the annotated `v1.0.0` tag on that commit.

| Field | Value |
|---|---|
| Release commit (pinned) | `__________` |
| CI run (green) | `__________` |
| Decision | ☐ APPROVED — release  /  ☐ HELD |
| Authority (name / role) | `__________` |
| Date | `__________` |

**After this section is signed:** promote `release-notes-v1.0.0.md` from DRAFT (pin its release commit),
cut `git tag -a v1.0.0 -F docs/notes/release-notes-v1.0.0.md <release-commit>`, then push the tag and add
the `[Unreleased]` → `[1.0.0]` split to `CHANGELOG.md`.

## Related
- `release-governance.md §Release Authority` — the policy this record satisfies.
- `release-notes-v1.0.0.md` — the tag annotation (DRAFT until this is signed).
- `track-a-charter.md` — A4 (this record + the cut) is the terminal item.
- `release-gate.md` — the runnable readiness checklist behind §2.
