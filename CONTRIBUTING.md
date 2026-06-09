# Contributing to Paradigm Terra

Thank you for your interest. This project has an unusual property that shapes every contribution: a
large part of it is **frozen consensus**, and the rules below exist to keep that frozen surface
byte-identical while still letting everything above it evolve freely. Read the one section that applies
to your change.

## The one question that decides everything: does it touch the Freeze Surface?

The **Freeze Surface** is the frozen-consensus bundle inventoried in
[`docs/spec/freeze-manifest-pfc1.md`](docs/spec/freeze-manifest-pfc1.md): the consensus spec, the
NORMATIVE vectors, the proof artifacts, and the validation evidence. Concretely, the normative code is
`canonical*/`, `dsl*/`, `cal*/`, `validator*/`, `cal-reducer*/`, `cal-gas*/`, and the consensus parts of
the orchestrator — plus `docs/spec/*` and `spec/vectors/*`.

You don't have to guess. The mechanical test is the CI `freeze-gate` job:

```
scripts/repro.sh vectors-check     # NORMATIVE vectors still reproduce
scripts/repro.sh verify-proof-ts   # Proof Package #1 reproduces in TS
scripts/repro.sh verify-proof-go   # ...and in Go
```

If your change makes any of those go RED, it is a **Freeze-Surface change**. If they stay green, it is
**operational**.

### Operational changes (above the Freeze Surface) — the normal path

Daemon, monitoring, tooling, CI, docs, tests, and any new capability that doesn't alter frozen
consensus. These are ordinary pull requests:

1. Branch off the current operational head (the `track-a/*` / `post-freeze/*` line — **not** the freeze
   line). Operational fixes flow **up** the `L1 → L2 → L3 → Track A` merge stack, never down into the
   freeze line (`docs/notes/post-freeze-roadmap.md`).
2. Keep the change above the Freeze Surface. If you find yourself editing `docs/spec/*`, a normative
   implementation, or a vector, stop — that's the other path.
3. `scripts/repro.sh` (or `make`) must pass, including `freeze-gate` staying green. Add a new gate by
   adding a `repro.sh` target, **not** by editing `.github/workflows/ci.yml`
   ([`docs/notes/release-gate.md`](docs/notes/release-gate.md)).
4. Open a PR describing what changed and why it is operational (i.e. why `freeze-gate` is unaffected).

The worked precedent is the `[pfc1/test]` roundtrip fix (`e731e07`): a test-only correction made on the
freeze line and merged **up** the stack, leaving the Freeze Surface byte-identical.

### Freeze-Surface changes — the governed path

Any change to consensus, economics, the validator, canonicalization, the spec, the NORMATIVE vectors,
or the proof artifacts. Per [`docs/notes/release-governance.md`](docs/notes/release-governance.md), this
is **not** an ordinary PR. It requires, in order:

1. a **separate review process** — open an issue first; do not start with a code PR;
2. a **dedicated freeze branch** — not an operational branch;
3. **regenerated evidence** — vectors re-promoted to NORMATIVE, Proof Package re-verified in TS *and* Go;
4. a **new freeze decision** — an explicit ruling (the precedent is `docs/notes/pfc1-status-review.md §0`).

A change that touches the Freeze Surface cannot be a MINOR or PATCH release — it is MAJOR and starts a
new freeze line (e.g. `pfc2-consensus-freeze`). If that sounds heavy, it is: the frozen surface is the
thing the whole project's value rests on.

## Cross-language parity is non-negotiable

The canonical encoding and the CAL pipeline are implemented three times — **TypeScript (reference),
Rust, and Go** — and must agree **byte-for-byte**. If you change behavior in one, you change it in all
three, and the golden vectors / differential fuzzers must stay CLEAN. The Rust builds are constrained
(musl-static, **zero C toolchain**, no build scripts / proc-macros); the Go builds use `CGO_ENABLED=0`.
A change that can't hold in all three runtimes under those constraints isn't ready.

## Versioning & releases

The project uses **SemVer**, and releases are governed —
[`docs/notes/release-governance.md`](docs/notes/release-governance.md) is authoritative on versioning,
release authority, and support. Contributors don't cut releases; maintainers do, against a recorded
sign-off. Add a `CHANGELOG.md` entry under **[Unreleased]** describing your change.

## Security

Do **not** file security or consensus-divergence reports as public issues — see
[`SECURITY.md`](SECURITY.md) for the private disclosure path.

## Checklist before opening a PR

- [ ] I identified whether my change touches the Freeze Surface (`freeze-gate` green ⇒ operational).
- [ ] `scripts/repro.sh` / `make` passes locally, `freeze-gate` included.
- [ ] If I changed normative behavior, all three (TS / Rust / Go) agree and vectors stay CLEAN.
- [ ] I added a `CHANGELOG.md` **[Unreleased]** entry.
- [ ] Security/consensus-divergence findings go through `SECURITY.md`, not a public issue.
