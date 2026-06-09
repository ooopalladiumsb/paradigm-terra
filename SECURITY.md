# Security Policy

Paradigm Terra is a deterministic consensus/execution protocol. A security report here is most often a
**consensus-correctness** report — a way to make two faithful implementations disagree, to make the
validator accept what it must reject (or vice-versa), or to make a canonical encoding non-canonical. We
treat those with the same seriousness as a classic memory-safety bug, and the disclosure path below
routes directly into the project's governed Emergency Response process.

## Reporting a vulnerability

**Please do not open a public issue for a security report.** Use GitHub's private vulnerability
reporting on this repository (**Security → Report a vulnerability**), which opens a private advisory
visible only to maintainers. If that channel is unavailable to you, open a public issue titled only
`security: request a private channel` (no details) and a maintainer will follow up privately.

Include, as far as you can:

- which surface is affected — **Freeze Surface** (canonical encoding / DSL / CAL / validator / reducer /
  gas / consensus spec) or **operational** (daemon / monitoring / tooling / CI);
- a **reproduction**: ideally a failing vector, a divergence between two of the TS / Rust / Go
  implementations, or a `scripts/repro.sh` invocation that demonstrates the defect;
- the commit or tag you observed it on (`git rev-parse HEAD`, or a release / freeze tag).

The Freeze-Surface vs operational distinction is the single most useful thing you can tell us: it
determines the governance path your report takes (see below).

## What happens next

We follow `docs/notes/release-governance.md §Emergency Response`. Triage is by **where the defect lives**:

- **Operational defect** (above the Freeze Surface — daemon, monitoring, tooling, CI): fixed on an
  operational branch and shipped as a PATCH/MINOR. No freeze decision needed.
- **Consensus defect** (anything on the Freeze Surface): handled as **incident declaration →
  root-cause analysis → freeze-line governance review → an explicit decision** whether a new freeze
  line (MAJOR) is required. A confirmed Freeze-Surface defect **re-opens the freeze** — this is OVT
  criterion 7, and it is permanent (`docs/notes/pfc1-status-review.md §0`).

The mechanical discriminator we use is the same one CI uses: if the `freeze-gate` job
(`vectors-check` + `verify-proof-ts` + `verify-proof-go`) would change, it is a consensus defect.

## Scope

- **In scope:** the protocol and its reference implementations in this repository — consensus
  divergence, validator soundness, canonicalization escapes, gas/economic-invariant breaks, replay /
  recovery correctness, signature-verification (TC v2) flaws.
- **Out of scope (here):** third-party wallets, the live TON network, and deployed contracts are not
  governed by this repository. Integration-boundary findings are welcome as **Integration Reality Risk**
  notes, but they are not Freeze-Surface defects.

## Supported versions

Only the **current freeze line** is supported (`docs/notes/release-governance.md §Support Policy`). The
active line is **PFC-1** (`pfc1-consensus-freeze`). Prior freeze lines remain archived and reproducible
but are not maintained unless explicitly reactivated by a new freeze decision. Reproducibility is
permanent; maintenance is not.
