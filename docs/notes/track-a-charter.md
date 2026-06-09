# Track A — Launch Readiness charter

**Date:** 2026-06-08 · Branch `track-a/launch-readiness` · Opens the launch track after PFC-1 Consensus
Freeze (`pfc1-status-review.md §0`) + PP#2 (testnet, A.SUCCESS) + H3.5 (offline & live) + **PR-1
Production Readiness CLOSED** (`pr1-closure-report.md`). **This is release engineering, not model
validation and not operational engineering.** Like the OVT, PP#2, and PR-1 charters, it fixes the
discipline, the Definition of Done, and the one thing that matters — before the artifacts.

This charter is written **after** its first two items already shipped (A1 governance, A5 CI/gate, both
done). That is deliberate: Track A grew organically out of closing PR-1, and this charter retrofits a
spine onto it — naming what was built, what remains, and the terminal act that ends the track.

## The transition this track marks

```
"Can this consensus model work?"        → ANSWERED (OVT + PP#2 + H3.5)
        ↓
"Can a third party verify it works?"    → ANSWERED (H3.5 independent reproduction)
        ↓
"Can we operate it for years?"          → ANSWERED (PR-1 Production Readiness)
        ↓
"Can we declare a version released,     → Track A (this track)
 and could a stranger reconstruct that
 decision from the repo alone?"
```

Every prior track answered a question about the *system*. Track A answers a question about the
*release process*: it produces no new consensus, no new operational capability — only the governed,
auditable act of cutting the inaugural `vX.Y.Z` against the frozen line.

## The thing that matters: auditable release authority

Not features, not a marketing surface, not download counts. The single discriminator Track A is built
around:

```
A stranger, given only the repository, can reconstruct the entire release decision —
what shipped, on which freeze line, who declared it, and why that SemVer bump.
```

This is the launch-time mirror of OVT criterion 7 (independent reproduction) applied to *governance*
rather than to *consensus*: if a release decision exists only in someone's head or in chat, it didn't
happen (`release-governance.md §Auditability`). Green CI is necessary but not sufficient — it asserts
technical readiness; the sign-off asserts intent to ship and accepts the support obligations.

## Discipline (anti-scope)

- Track A lives **strictly above the Freeze Surface** — process, documentation, and release tooling
  only. It touches no canonical/dsl/cal/validator/reducer/gas normative code, and no operational kernel
  (that was PR-1). A Freeze-Surface defect surfaced here still re-opens the freeze (criterion 7 is
  permanent), but that is not Track A's goal.
- **No new capability of any kind** — no verbs, no daemon features, no spec changes. Track A ships the
  *current* proven system as a versioned artifact. Coverage and capability expansion are post-launch
  tracks on their own lines (and consensus expansion is a new freeze line entirely).
- The inaugural cut is **`v1.0.0` riding `pfc1-consensus-freeze`** — the release tag and the freeze tag
  stay distinct (`release-governance.md §Versioning`); the release tag's notes name the freeze line.
- The merge stack is preserved: fixes flow **up** the `L1 → L2 → L3 → Track A` line, never down into the
  freeze line (`post-freeze-roadmap.md`). The `[pfc1/test]` roundtrip fix (`e731e07`) is the worked
  precedent — made on the freeze line, merged up, Freeze Surface left byte-identical.

## Stages

| Stage | Goal | State | Closes |
|---|---|---|---|
| **A1** | **Release Governance** — versioning (SemVer), freeze lines, freeze-adjacent process, release authority, support, emergency response, auditability | ✅ DONE (`4bccf36`) | the *who/under-what* half of the gate |
| **A5** | **CI + Release Gate** — GitHub Actions as a thin wrapper over `make → repro.sh`; the runnable readiness checklist; the `freeze-gate` job as the mechanical Freeze-Surface discriminator | ✅ DONE (`5c52ac0`, `8021f18`) | the *when-technically-releasable* half of the gate; mechanizes hand-verification |
| A2 | **Public front door** — root README reflects PR-1-closed + launch posture (not just freeze); add `SECURITY.md` (responsible disclosure routed to §Emergency Response) and `CONTRIBUTING.md` (the merge-stack + freeze-adjacent rules for outside contributors); seed `CHANGELOG.md` at the freeze baseline | ✅ DONE (`9042bd8`) | a stranger can land, understand status, and know the contribution/disclosure rules |
| A3 | **Release notes + changelog** — the `v1.0.0` annotated-tag content per §Release Authority (release commit + freeze line it rides, validation-artifact links, SemVer bump rationale); the corresponding `CHANGELOG.md` entry | ✅ DRAFT (`db06d51`) | the auditable *content* of the release (promoted from DRAFT at sign-off) |
| A4 | **Sign-off + cut the tag** — the recorded governance decision (commit ids, PP#2/H3.5/OVT links, closure reports, release notes) **and** the act of cutting the annotated `v1.0.0` tag on the green release commit | ✅ DONE (2026-06-09) — **released `v1.0.0`** | the terminal act — the release is *declared*, not merely *ready* |

**A4 was human-gated by design and is now signed.** Per `release-governance.md §Release Authority` the
cut required an explicit recorded sign-off — green CI necessary, not sufficient. The Release Authority
(ooopalladiumsb) decided **"Approve release v1.0.0"** on 2026-06-09; `release-signoff-v1.0.0.md` is
SIGNED, `release-notes-v1.0.0.md` promoted from DRAFT, and the annotated tag `v1.0.0` cut on the release
commit (required gate verified green: `freeze-check` + `parity`). **Track A is COMPLETE.**

**Why this order (not the label order):** A1 and A5 — the gate's two halves — already exist, so the
remaining path is front door (A2) → release content (A3) → governed cut (A4). A4 is terminal by
construction: nothing follows the sign-off but the tag it authorizes.

## Definition of done (Track A complete when all hold)

1. **Governance ratified** — `release-governance.md` is the authoritative versioning/authority/support
   policy; `release-gate.md` points at it. *(A1 ✅)*
2. **Gate is runnable and mechanized** — required CI jobs (`ts-ops`, `freeze-gate`, `go-parity`) green on
   the release commit; new gates are added via `repro.sh` targets, not by editing CI. *(A5 ✅)*
3. **Public front door is honest and complete** — README states PR-1-closed/launch posture; `SECURITY.md`
   + `CONTRIBUTING.md` + `CHANGELOG.md` + `LICENSE` all present and consistent with governance. *(A2)*
4. **Release content is auditable** — `v1.0.0` notes + `CHANGELOG.md` name the freeze line, the release
   commit, the validation artifacts, and the bump rationale. *(A3)*
5. **The release is declared, not just ready** — a recorded sign-off per §Release Authority, and the
   annotated `v1.0.0` tag cut on the green release commit, riding `pfc1-consensus-freeze`. *(A4)*
6. **The discriminator holds** — a stranger with only the repo can reconstruct the whole release
   decision from tags, merged PRs, closure reports, and the artifacts they reference. *(spans A1–A4)*

## Roadmap position

```
PFC-1 Consensus Freeze  ✅
  → PP#2 Confirmed       ✅ (ton-testnet, A.SUCCESS)
  → H3.5 Reproduction    ✅ (offline + live)
  → PR-1 Production Readiness  ✅ (operationally validated)
  → Track A Launch Readiness   ◀ this track  ⇒  inaugural v1.0.0
```

## Related
- `release-governance.md` — A1; the authority this track executes against.
- `release-gate.md` — A5; the runnable readiness checklist + CI wrapper.
- `pr1-closure-report.md` — the Production-Readiness evidence the release rides on.
- `freeze-manifest-pfc1.md` — the Freeze Surface inventory `v1.0.0` rides.
- `pfc1-status-review.md` — the PFC-1 freeze ruling (the precedent for governed declarations).
- `post-freeze-roadmap.md` — the branch/freeze discipline and the L1→L2→L3→Track A merge stack.
- `pr1-charter.md` — the prior charter this one follows in form.
