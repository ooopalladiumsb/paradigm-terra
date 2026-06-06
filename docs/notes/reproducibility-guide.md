# Reproducibility guide (clean-room)

**Date:** 2026-06-06 · **Status:** reproducibility hardening — the offline precursor to OVT-3 / H3.5
("an external observer reproduces the results independently"). Promotion criterion #3 of
`pfc1-status-review.md`.

**Goal.** A stranger, on a fresh checkout, with no project history, reproduces the freeze-candidate
evidence — and gets **byte-identical roots** where the artifacts are deterministic, and sees the
**stated invariants** where they are not. This document makes that split explicit (it is real: most
generative OVT scripts mint fresh keys per run) and pins the toolchain it was validated on.

---

## 1. Pinned toolchain (validated 2026-06-06)

| Tool | Validated version | Pin | Needed for |
|---|---|---|---|
| Node.js | 22.22.2 | `engines.node: ">=22"` (each TS `package.json`) | all TS targets |
| npm | 10.9.7 | — | setup |
| tsx | 4.22.x | TS `devDependencies` (`^4.19`/`^4.22`) | running `.ts`/`.mjs` scripts |
| Go | 1.26.3 | `go 1.26.3` (each `go.mod`) | Go parity + `verify-proof`/`soak` |
| Rust | 1.95.0 (cargo 1.95.0) | musl static, bundled `rust-lld` (per-crate `.cargo/config.toml`) | `parity` only |

`CGO_ENABLED=0` for all Go (no C toolchain). The Rust crates build a musl static target with the
bundled `rust-lld` — **no system C compiler, no build scripts, no proc-macros** (a deliberate
constraint). Rust is needed only for the full tri-language `parity` target; the core deterministic
reproduction (`freeze-check`) is TS + Go.

## 2. Setup (dependency order matters)

```bash
scripts/setup.sh          # or: make setup
```

Installs + builds the TS reference packages **in topological order**
(`canonical → dsl → cal → cal-reducer → cal-gas → validator → orchestrator`). This order is
mandatory: each depends on its predecessors via `file:` links that resolve to the predecessor's
built `./dist`, so a dependant cannot install/typecheck until its deps are built. Network is needed
once, for the registry devDeps (`tsx`, `typescript`, `@types/node`); the cross-package deps are
local. Go and Rust need no pre-build (`go test` / `cargo test` build on demand).

## 3. The two target classes

The reproduction surface splits in two. **Do not** expect fixed roots from the property targets.

### 3.1 Deterministic-root targets — an external observer gets IDENTICAL bytes

| Target | Reproduces | How |
|---|---|---|
| `repro.sh vectors-check` | every golden vector is `NORMATIVE` | grep the pinned `status` |
| `repro.sh verify-proof` | **Proof Package #1** roots, TS **and** Go | re-derives PP#1 from its own contents |
| `repro.sh parity` | TS == Rust == Go on every golden vector | each runtime recomputes the pinned vectors |
| `repro.sh freeze-check` | `vectors-check` + `verify-proof` (the fast gate) | — |
| `OVT_SEED=<hex> repro.sh ovt3-soak` | the soak's `final_state_root` + `event_log_sha256` | keys derived from the seed (§4) |

These are **fixed**: the golden vectors and Proof Package #1 are pinned artifacts (the Go ports
reproduce them byte-for-byte), and a seeded soak is deterministic. Expected PP#1 values (diff these):

```
cal_hash          0xacfe6450b5f51fba682a35fa9b555630176212f75c3487e396f5e04403cdc426
state_root_before 0x67153467669e7887e42dfe811b6b45d3d117479eed323c0eb40f87abe0f56c00
state_root_after  0x6214ede02365e5c8a5a23703ba9b036ba4579ec62e0943032dfa84a87e2d439d
event_log root    0xf94e2e8ced32e9f4eb48fdc75fb3f5899f90d0c845403ae4852821e773583104
events            cal.created→cal.signed→cal.validated→cal.executed→cal.settled→cal.finalized
```

### 3.2 Property targets — verify INVARIANTS, not fixed roots

| Target | Asserts (the property) | Roots reproducible? |
|---|---|---|
| `repro.sh ovt1` | autonomous loop construct→sign→execute→submit→FINALIZED (H1.x) | no (fresh keys) |
| `repro.sh ovt2` | crash → replay → identical STATE_ROOT **within the run** (H2.x) | no (fresh keys) |
| `repro.sh ovt-sg` | cold-recovery cost curve is linear (state-growth) | no (fresh keys) |
| `repro.sh ovt3-soak` | 0 divergences TS == Go over a continuous stream (H3.2/H3.3) | **only with `OVT_SEED`** |
| `repro.sh ovt3-griefing` | every attack class is economically/structurally bounded (H3.4) | n/a (verdict) |

**Why the split exists.** These scripts mint **fresh Ed25519 keypairs per run** (autonomy / no
fixtures), and the registry stores each agent's pubkeys in `state`, so the `STATE_ROOT` varies per
run by design. They therefore assert *properties* (a CAL reaches FINALIZED; crash==replay; 0
divergences; bounded griefing), not fixed hashes. This is correct — but it means "reproduce the same
root" maps onto §3.1's pinned artifacts, not these scripts, unless you seed them (§4).

## 4. Deterministic-seed mode (`OVT_SEED`)

Set `OVT_SEED` to make a generative run reproducible: every key is derived deterministically from the
seed (`ed25519FromSeed` in `orchestrator/src/agent/ovt-agent.ts`), so the same seed yields the same
roots and a different seed yields different roots. Wired into the soak:

```bash
OVT_SEED=pfc1-clean-room repro.sh ovt3-soak     # same seed → same final_state_root + event_log_sha256
```

Verified: same seed → identical roots across runs; different seed → different `final_state_root`; the
Go leg reproduces the seeded TS roots with 0 divergences. (`event_log_sha256` is seed-independent —
pubkeys live in `state`, not in the event log — but is still reproducible.) The same `seed?:` seam
exists on `OvtAgent` / `LocalTestOwnerSigner` for the other generative scripts if exact-root
reproduction of those is ever needed.

**Caveat:** `orchestrator/vectors/soak-stream.json` is a regenerated, gitignored artifact; its
`meta.generated_at` is a wall-clock timestamp and will differ between runs. Compare the **roots**
(`expected.final_state_root`, `expected.event_log_sha256`, per-tick roots), not the whole file — that
is exactly what `orchestrator-go/cmd/soak` does.

## 5. Minimal clean-room run

```bash
make setup                 # install + build TS in dep order
make freeze-check          # deterministic-root reproduction (TS == Go) — diff against §3.1
make parity                # full TS == Rust == Go (needs Rust)
OVT_SEED=any-string scripts/repro.sh ovt3-soak   # reproducible continuous-parity soak
scripts/repro.sh ovt3-griefing                   # bounded-griefing verdict
```

## 6. Related
- `pfc1-status-review.md` — promotion criteria (this is #3).
- `operational-validation-track.md` — OVT charter; H3.5 (the live half needs a network).
- `freeze-manifest-pfc1.md` — the normative inventory being reproduced.
