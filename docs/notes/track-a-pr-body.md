# Track A — Launch Readiness (complete except Release Authority)

> **Versioned PR narrative.** This is the canonical description of the Track A pull request, kept in the
> repository so the argument survives independent of any forge. It is deliberately **PR-number-neutral** —
> it references commits, not a PR id, because the number is an external representation that can change if
> the PR is closed, re-created, or backported. Base branch: `post-freeze/pr1`. Range: `3d9f6d7..` (the
> eight commits below).

## Summary

The documentation and governance track that follows the closure of PR-1 (Production Readiness). It turns
an operationally validated system into a **governed, auditable launch posture** — without shipping a
release. It produces no consensus, no operational capability, and no version tag: only the policy, the
public front door, and the prepared (but unsigned) release machinery for the inaugural `v1.0.0`.

Track A is **complete except for Release Authority**: every artifact a release needs exists, reviewed and
in the repo, but the act of *declaring* the release is deliberately withheld pending an explicit human
sign-off (`release-governance.md §Release Authority`).

## Scope

- **Strictly above the Freeze Surface.** No change to canonical encoding / DSL / CAL / validator /
  reducer / gas, to `docs/spec/*`, or to any NORMATIVE vector. `freeze-gate` (`vectors-check` +
  `verify-proof-ts` + `verify-proof-go`) stays green across the entire range — verified locally via
  `make vectors-check`.
- **Not a release.** No `vX.Y.Z` tag is cut; `release-notes-v1.0.0.md` stays DRAFT; the sign-off form is
  UNSIGNED. Nothing here requires Release Authority to merge.
- **Process, docs, and release tooling only.** The merge stack discipline is preserved: changes flow
  **up** the `L1 → L2 → L3 → Track A` line, never down into the freeze line.

## Status

```text
Track A status: COMPLETE — RELEASED v1.0.0 (2026-06-09)

A0 Charter                  ✅  7190955
A1 Governance               ✅  4bccf36
A2 Public-facing docs       ✅  9042bd8
A3 Release Notes            ✅  db06d51  (promoted from DRAFT at sign-off)
A4 Sign-off + cut           ✅  18c32e3  (SIGNED; tag v1.0.0 cut)
A5 CI + Release Gate        ✅  5c52ac0 / 8021f18

Release Authorization       ✅ Approved — "Approve release v1.0.0" (ooopalladiumsb, 2026-06-09)
v1.0.0 Tag                  ✅ Cut (annotated, riding pfc1-consensus-freeze)
```

## Artifacts

| Item | Commit | Artifact |
|---|---|---|
| **A0** Charter | `7190955` | `docs/notes/track-a-charter.md` — track spine; DoD = a *declared* (not merely ready) v1.0.0. |
| **A1** Governance | `4bccf36` | `docs/notes/release-governance.md` — SemVer, freeze lines, freeze-adjacent process, release authority, support, emergency response, auditability. |
| **A2** Public front door | `9042bd8` | `README.md` (de-staled: PR-1-closed + launch posture), `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`. |
| **A3** Release notes | `db06d51` | `docs/notes/release-notes-v1.0.0.md` — **DRAFT**; SemVer rationale (first release on a freeze line ⇒ 1.0.0), contents, evidence, scope/limits. |
| **A4** Sign-off form | `18c32e3` | `docs/notes/release-signoff-v1.0.0.md` — **UNSIGNED**; verifiable fields pre-filled, Decision section left for governance. |
| **A5** CI + Release Gate | `5c52ac0` / `8021f18` | `.github/workflows/ci.yml` (thin wrapper over `make → scripts/repro.sh`), `docs/notes/release-gate.md`; first CI finding recorded. |

(The range also includes `56bbcdb` — the merge of the L1 test-only fix up into Track A — between A5 and A1.)

## Release Authority Boundary

This PR stops exactly at the boundary the governance defines. Merging it does **not** release anything.
The release trigger is a separate, explicit decision:

> **Approve release v1.0.0**

Only after that decision is it correct to:

1. pin the concrete **release commit**;
2. confirm **green CI** on it (`ts-ops`, `freeze-gate`, `go-parity`);
3. complete the **Decision** section of `release-signoff-v1.0.0.md §6`;
4. promote `release-notes-v1.0.0.md` from DRAFT (pin its release-commit line);
5. cut the annotated tag — `git tag -a v1.0.0 -F docs/notes/release-notes-v1.0.0.md <release-commit>`;
6. publish (push the tag; split `CHANGELOG.md` `[Unreleased]` → `[1.0.0]`).

Green CI is necessary but not sufficient; the sign-off asserts intent to ship and accepts the support
obligations (`release-governance.md §Support Policy`).

## Merge Criteria

- [ ] `freeze-gate` green on the PR head (Freeze Surface unchanged — the whole point).
- [ ] `ts-ops` and `go-parity` green.
- [ ] Reviewer confirms the change is entirely above the Freeze Surface (no `docs/spec/*`, no normative
      impl, no vector touched).
- [ ] `release-notes-v1.0.0.md` is still DRAFT and `release-signoff-v1.0.0.md` is still UNSIGNED (this PR
      must not, by itself, release).

## Project layering (context)

```text
L1  Consensus + Freeze        (freeze line: pfc1-consensus-freeze)
L2  PP#2 + H3.5
L3  Production Readiness       (PR-1, closed)
L4  Launch Readiness          (Track A — this PR)

v1.0.0 release
    └─ awaits Release Authority sign-off
```

## Related
- `release-governance.md` — the authority this track executes against.
- `track-a-charter.md` — the track spine (A0).
- `release-notes-v1.0.0.md` / `release-signoff-v1.0.0.md` — the held release machinery (A3 / A4).
- `pr1-closure-report.md` — the Production-Readiness evidence the release will ride on.
