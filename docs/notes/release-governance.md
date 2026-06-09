# Release Governance (A1)

**Track A · Launch Readiness.** This document defines how frozen-consensus releases of Paradigm Terra
are **versioned, approved, published, and maintained**. It is the governance half of the Release Gate:
`release-gate.md` says *when a build is technically releasable* (a runnable checklist); this says *who
may declare it released, under what version, and with what obligations afterward*. It applies to every
release after **PFC-1 Consensus Freeze** (ruled 2026-06-06; `freeze-manifest-pfc1.md §0`).

It lives **above the Freeze Surface** — it is an operational/process artifact and changes to it never
touch frozen consensus. Like every other claim in this repo, each rule below points at a runnable check
or a merged artifact, not at a verbal agreement (see §Auditability).

---

## Governance Principles

1. **Consensus correctness takes precedence over feature velocity.** A release ships late before it
   ships with an un-reproduced Freeze Gate.
2. **The Freeze Surface is immutable within a freeze line.** Its inventory is `freeze-manifest-pfc1.md`
   (spec, normative vectors, proof artifacts, validation evidence). No release on a line may alter it.
3. **Production-readiness evolves independently from consensus.** The L1→L2→L3→Track A merge stack
   (operational fixes flow *up*, never down into the freeze line) is the structural expression of this:
   e.g. the `[pfc1/test]` roundtrip fix (`e731e07`) was made on the freeze line and merged up, leaving
   the Freeze Surface byte-identical.
4. **Every release decision is traceable to repository artifacts.** No release state exists only in
   someone's head or in chat.

## Versioning Policy — SemVer

The project uses **Semantic Versioning**. There is no SemVer tag yet (only `pfc-1` and
`pfc1-consensus-freeze`); this document is the **inaugural** versioning authority, so the first
launch-ready cut is the first `vX.Y.Z` tag.

| Bump | Meaning | Example trigger |
|---|---|---|
| **MAJOR** | new consensus freeze line, or any consensus-breaking change | PFC-2 supersedes PFC-1 |
| **MINOR** | backward-compatible operational capability | a new daemon/monitoring feature above the Freeze Surface |
| **PATCH** | docs, tooling, CI, test-only corrections, non-consensus fixes | the `[pfc1/test]` provisioning fix; a new `repro.sh` target |

**Rule of thumb:** if the change touches a Freeze Surface artifact it cannot be MINOR or PATCH — it is
MAJOR *and* it requires a new freeze line (see Freeze-Adjacent Changes). Everything mergeable into an
operational branch without regenerating evidence is MINOR or PATCH.

The freeze tag (`pfcN-consensus-freeze`) and the release tag (`vX.Y.Z`) are **distinct**: the freeze tag
marks *what was proven*, the release tag marks *what was shipped on top of it*. A release tag's notes
MUST name the freeze line it rides on.

## Freeze Lines

**Exactly one freeze line is active at a time.** The active line is PFC-1 (`pfc1-consensus-freeze`,
frozen HEAD `2fd4b8a`; published PFC-1 tag `8d9881f`). A freeze line is the four-part bundle in
`freeze-manifest-pfc1.md`:

- frozen consensus specification (`docs/spec/*` — CE, DSL, CAL, execution-spec, TC v2 boundaries);
- normative vectors (golden + tc-v2 manifests — gated by `make vectors-check`);
- proof artifacts (Proof Package #1 — `make verify-proof-ts` + `make verify-proof-go`);
- validation evidence (OVT + PP#2 + H3.5).

**New freeze lines do not modify prior freeze lines.** A future PFC-2 starts its own branch, vectors,
and proofs; PFC-1's artifacts stay exactly as tagged.

## Freeze-Adjacent Changes

Any change affecting a Freeze Surface artifact (consensus spec, normative vectors, proof artifacts,
validation evidence) requires **all four**, in order:

1. a **separate review process** — not an ordinary operational PR;
2. a **dedicated freeze branch** — not an operational branch;
3. **regenerated evidence** — vectors re-promoted to NORMATIVE, Proof Package re-verified in TS *and* Go;
4. a **new freeze decision** — an explicit ruling (as PFC-1's lives in `pfc1-status-review.md §0`).

**Operational branches MUST NOT modify Freeze Surface artifacts.** This is mechanically observable: the
`freeze-gate` CI job (`vectors-check` + `verify-proof-ts` + `verify-proof-go`) goes RED if the surface
moved. CI catching such a drift is a process success, not noise.

## Release Readiness Requirements

A release may be declared **READY** only when every Release Gate item holds (the authoritative,
runnable form is `release-gate.md`):

| Requirement | Enforced / evidenced by |
|---|---|
| CI green | required jobs `ts-ops`, `freeze-gate`, `go-parity` pass on the release commit |
| Freeze Gate green | `freeze-gate` job — vectors NORMATIVE + Proof Package #1 reproduces in TS and Go |
| PP#2 complete | testnet tx `8d4b96e6…`, on-chain effect == CAL action (`proof-package-2-spec.md`) |
| H3.5 complete | offline + live re-derivation (`reproducibility-guide.md §6`, `pr1.8-live-observer.md`) |
| PR-1 complete | operational kernel merged (`pr1-closure-report.md`) |
| Closure Report current | its commit range + risk-class table match the release commit |

Any unchecked item ⇒ **NOT releasable**. `rust-parity` is *optional* on the first line (toolchain
tuning) and is not a readiness blocker; promote it to required once stable.

## Release Authority

Release approval requires **explicit sign-off by project governance** — a recorded decision, not an
implicit consequence of green CI. (Green CI is necessary, not sufficient: it asserts technical
readiness; the sign-off asserts the *intent to ship* and accepts the support obligations below.)

The sign-off record MUST include:

- **commit identifiers** — the release commit + the freeze line it rides on;
- **validation artifacts** — links to PP#2, H3.5, OVT evidence;
- **closure reports** — `pr1-closure-report.md` (and any successor) at the release commit;
- **release notes** — the `vX.Y.Z` tag annotation, naming the freeze line and the SemVer bump rationale.

## Support Policy

**Only the current freeze line is supported.** Prior freeze lines remain **archived and reproducible**
(every tagged line reproduces via `scripts/repro.sh` / `reproducibility-guide.md`) but are **not
maintained** unless explicitly reactivated by a new freeze decision. Reproducibility is permanent;
maintenance is not.

## Emergency Response

Triage by **where the defect lives**, because that decides the governance path:

- **Operational incident** (daemon, monitoring, tooling, CI — above the Freeze Surface): corrected on an
  **operational branch**, shipped as a PATCH/MINOR. No freeze decision needed.
- **Consensus defect** (anything on the Freeze Surface) requires, in order:
  1. **incident declaration**;
  2. **root-cause analysis**;
  3. **freeze-line governance review** (the Freeze-Adjacent process above);
  4. an **explicit decision** whether a new freeze line (MAJOR) is required.

The discriminator is the same one CI uses: if `freeze-gate` would change, it is a consensus defect.

## Auditability

Every release decision MUST be reproducible from repository history alone — tags, merged PRs, closure
reports, and the artifacts they reference. **No release decision may depend solely on verbal agreement
or an unpublished artifact.** If it isn't in the repo, it didn't happen.

---

## Related
- `release-gate.md` — the runnable readiness checklist this governs (A5.1); §"Governance starting position" was the stub this expands.
- `freeze-manifest-pfc1.md` — the Freeze Surface inventory (what §Freeze Lines refers to).
- `pfc1-status-review.md` — the PFC-1 freeze ruling + promotion criteria (the precedent for §Release Authority / §Emergency Response).
- `post-freeze-roadmap.md` — branch/freeze discipline (the L1→L2→L3→Track A stack behind §Governance Principles).
- `pr1-closure-report.md` — the Production-Readiness evidence §Release Readiness references.
- `proof-package-2-spec.md`, `reproducibility-guide.md`, `pr1.8-live-observer.md` — PP#2 / H3.5 evidence.
