# Release Gate (A5.1)

**Track A · Launch Readiness.** The single checklist that says when a build is releasable — the bridge
between the research artifacts (Freeze / PP#2 / H3.5) and the operational layer (PR-1). Above the Freeze
Surface.

## Release READY iff

```
✓ CI green            — ts-ops + freeze-gate + go-parity (required jobs) pass on the release commit
✓ Freeze Gate green   — vectors NORMATIVE + Proof Package #1 reproduces in TS and Go (freeze-gate job)
✓ PP#2 confirmed      — testnet tx_hash, on-chain effect == CAL action (docs/notes/proof-package-2-spec.md)
✓ H3.5 confirmed      — offline + live independent re-derivation (reproducibility-guide.md, pr1.8-live-observer.md)
✓ PR-1 merged         — operational kernel on the release line (pr1-closure-report.md)
✓ Closure Report current — its commit range + risk-class table match the release commit
```

Any unchecked item ⇒ NOT releasable. None of these is asserted by a human claim alone — each maps to a
runnable check or a merged, reviewed artifact.

## How the gate maps to CI

| Gate item | Enforced by |
|---|---|
| CI green | the required jobs below |
| Freeze Gate | `freeze-gate` job (`make vectors-check` + `make verify-proof-ts` + `make verify-proof-go`) |
| typecheck / tests | `ts-ops` job (`make typecheck` + `make parity-ts`) |
| cross-language (Go) | `go-parity` job (`make parity-go`) + verify-proof-go above |
| PP#2 / H3.5 / PR-1 / Closure Report | merged PRs (#2→#3→#1 stack) + the docs they carry |

**Required CI checks** (set in branch protection on `main`): `ts-ops`, `freeze-gate`, `go-parity`.
`rust-parity` is **optional** on the first pass (toolchain tuning) — promote to required once stable.

## CI = thin wrapper (source of truth)

```
GitHub Actions (.github/workflows/ci.yml)
  → make <target>        (Makefile)
    → scripts/repro.sh   (the portable single source of truth — runs without make)
```
No build/test command is duplicated in the workflow. New gates are added by adding a `repro.sh` target,
not by editing CI.

## Governance starting position (A1 — to be expanded)

| Question | Starting position |
|---|---|
| Versioning | **SemVer** |
| Freeze-line support | only the **current** freeze line, until the next freeze (`pfcN-consensus-freeze`) supersedes it |
| Freeze-adjacent changes | only via a **separate governance/review process** — a change to consensus/economics/validator/canonicalization starts its own line + freeze (per `post-freeze-roadmap.md`) |

These are defaults to ratify in the full A1 Release Governance doc; they do not affect CI or the runbooks.

## Related
- `.github/workflows/ci.yml` — the required/optional jobs.
- `Makefile` / `scripts/repro.sh` — the targets CI calls (`typecheck` added in A5).
- `pr1-closure-report.md` — the PR-1 readiness evidence this gate references.
- `post-freeze-roadmap.md` — branch/freeze discipline behind the governance defaults.
