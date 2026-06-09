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

## Governance (A1 — see `release-governance.md`)

The defaults below are now **ratified and expanded** in `docs/notes/release-governance.md` (versioning,
freeze lines, freeze-adjacent process, release authority, support, emergency response, auditability).
This table is the at-a-glance summary; the governance doc is authoritative.

| Question | Starting position |
|---|---|
| Versioning | **SemVer** |
| Freeze-line support | only the **current** freeze line, until the next freeze (`pfcN-consensus-freeze`) supersedes it |
| Freeze-adjacent changes | only via a **separate governance/review process** — a change to consensus/economics/validator/canonicalization starts its own line + freeze (per `post-freeze-roadmap.md`) |

These do not affect CI or the runbooks; full rationale and obligations are in `release-governance.md`.

## CI findings

**2026-06-08 — first CI run caught a latent test-infra defect (and that is the point).** The very first
GitHub Actions run reported `ts-ops` RED while `freeze-gate` and `go-parity` were green. The cause was a
**stale test bench**, not a consensus issue: `cal-reducer/test/roundtrip.test.ts` under-provisioned the
agent registry (no `operator_pubkey`/`owner_pubkey`, no `operatorSigPresent`), so the frozen validator's
§8.1/§8.2 capability gate correctly returned `CAPABILITY_DENIED` before the test's intended
precond/invariant/step paths. **Consensus logic and the Freeze Surface were not changed**; golden
vectors, `verify-proof-ts`, `verify-proof-go`, PP#2 and H3.5 all remained green throughout. The fix was
limited to test provisioning (`operator_pubkey`, `owner_pubkey`, `operatorSigPresent`) on the freeze
line (`[pfc1/test]`), propagated up the stack by merge. After it, all required CI is green. This is the
intended value of A5: automated re-verification of what was proven by hand surfaced a defect no prior
(CI-less) process exercised — a useful precedent for future audits.

**2026-06-09 — `rust-parity` RED on the Track A PR is environmental, not a TS↔Rust regression
(confirmed).** On the Track A PR (`track-a/launch-readiness`, head `6ad02a0`) the three required jobs
`ts-ops`, `freeze-gate`, `go-parity` are green; the only red is the **optional** `rust-parity` job. The
GitHub Actions runner is not provisioned for this repo's Rust build model — `.cargo/config.toml` forces
a fully self-contained `x86_64-unknown-linux-musl` static build driven by the bundled `rust-lld`
(`link-self-contained=yes`), because there is no system C toolchain — so the job fails at build/link
setup, not on a test assertion. Locally, with that toolchain, `scripts/repro.sh parity-rs` is **green
across all eight crates** (`canonical-rs`, `dsl-rs`, `cal-rs`, `cal-reducer-rs`, `cal-gas-rs`,
`validator-rs`, `orchestrator-rs`, `tc-v2-verify-rs`) on `6ad02a0` — so the TS == Rust cross-language
parity holds; the red is purely the runner's build environment. This is exactly why `rust-parity` is
**optional** on the first freeze line and not a readiness blocker (toolchain tuning); promote it to
required once the runner reproduces the musl/`rust-lld` build. No Freeze Surface impact.

**2026-06-09 — M1: runner provisioned for the musl/`rust-lld` build (post-release v1.x, Tier M).** The
environmental RED above was traced to a single missing piece: `dtolnay/rust-toolchain@stable` installs
only the host `x86_64-unknown-linux-gnu` std, but every crate's `.cargo/config.toml` forces a
self-contained `x86_64-unknown-linux-musl` static build, so the runner had no musl target std to link
against (`rust-lld` itself ships with the toolchain). The fix is one runner-side line — `targets:
x86_64-unknown-linux-musl` on the toolchain step — so CI reproduces the **exact** build model the freeze
used locally (green across all eight crates). This is a runner-provisioning change only: no
`.cargo/config.toml`, source, or Freeze Surface edit. **Promotion sequence:** keep `continue-on-error`
for one observation cycle; once `rust-parity` is observed green on the runner, drop `continue-on-error`
and add `rust-parity` to the branch-protection required checks (`ts-ops`, `freeze-gate`, `go-parity`,
`rust-parity`) — completing the full three-language gate (TS == Rust == Go) on the 1.x line.

## Related
- `.github/workflows/ci.yml` — the required/optional jobs.
- `Makefile` / `scripts/repro.sh` — the targets CI calls (`typecheck` added in A5).
- `pr1-closure-report.md` — the PR-1 readiness evidence this gate references.
- `post-freeze-roadmap.md` — branch/freeze discipline behind the governance defaults.
