# Freeze Manifest — PFC-1

**Purpose.** A single authoritative record of *what is frozen* as the PFC-1 → Consensus-Freeze
candidate enters the quiet period — so that a month from now there is no argument about what counted
as frozen, what was deliberately deferred, and how to reproduce the status. This is an index, not a
re-derivation; every line points at the artifact that holds the truth.

**Provenance.** Branch `feat/tc-v2-sig-verify-v1`, HEAD `4a5eba2` (local; the published PFC-1 tag is
`8d9881f` on `github.com/ooopalladiumsb/paradigm-terra`). Reproduce any claim below with
`scripts/repro.sh <target>` (or `make <target>`) — see §5.

---

## 1. Gate status

| Gate | Status | Evidence |
|---|---|---|
| #1 Real Ed25519 | **satisfied-for-freeze** (Rust ingress deferred-by-constraint) | §2.4, §3 |
| #2 ns/op benchmark baseline | **closed** (1 advisory Tier-2 item parked) | §2.3, §4 |
| #3 Staged validator | **closed** | §2.2 |
| #4 Transport / happy-path (PFC-1 bounds) | **closed** (proven in TS + Go) | §2.5 |
| #5 Quiet period | **running** | — |

Gate #1 is recorded as *satisfied-for-freeze*, not unconditionally *closed*: the requirement met is
"the owner/operator authorization model is independently confirmed by ≥2 reference implementations
with cross-language parity and negative controls", which is satisfied. The single open sub-component
(Rust ingress) is **deferred-by-constraint**, not a known deficiency — see §3 and the Deferred
Register (§6).

### Gate #1 sub-components

| Sub-component | Status |
|---|---|
| Contract A (signData) verification | ✅ |
| Contract B (tonProof) verification | ✅ |
| TS ingress proof | ✅ |
| Go ingress proof | ✅ |
| TS↔Go parity on a real signed CAL | ✅ |
| Rust ingress verification | Deferred-by-constraint |
| **Freeze sufficiency** | ✅ |

---

## 2. Normative inventory

### 2.1 Normative specifications (`docs/spec/`)
- `canonical-encoding-v1.3.md` — Canonical Encoding v1.3 (Consensus-Freeze)
- `constraint-dsl-v1.1.md` — Constraint DSL
- `execution-spec-v1.md` — CAL Execution Spec (gas §9, validator §10, Annexes)
- `constitution-v0.9.5.md` — protocol constitution
- `cal-co-signature-envelope.md` — §8.3 operator/owner co-signature envelope
- `tc-v2-sig-verify-v1.md` — TON Connect v2 owner-sig Contracts A + B
- `tc-v2-contract-boundaries.md` — the A/B channel boundary (no shared serializer)

### 2.2 Normative golden vectors (parity-locked, cross-language byte-identical)
`canonical` · `dsl` · `cal` · `cal-reducer` · `cal-gas` · `validator` · `orchestrator`
(`<pkg>/vectors/golden.json`, each `status: NORMATIVE`). Plus the TC v2 owner-sig conformance
corpus `spec/vectors/tc_v2_sig_verify_v1/` (`manifest.json` NORMATIVE; positive / negative /
**cross-channel** vectors — the cross-channel set is mandatory: it proves the A and B channels do
not collide). Integrity gate: `scripts/repro.sh vectors-check`.

### 2.3 Gas model (Annex C)
Unit weights (`dsl/src/parse.ts` COST + `cal-gas/src/units.ts`) are the consensus-binding counts,
parity-locked by `cal-gas/vectors/golden.json` + the diff-fuzzer. §C.3 wall-clock columns are
**advisory** (§C.4) — see §4.

### 2.4 Authorization model (the headline invariant)
`operator authorization ≠ owner authorization`, enforced at four levels: spec (§8.1/§8.3 +
`tc-v2-sig-verify-v1.md`), envelope contract (`cal-co-signature-envelope.md`), validator
implementation (`operator_sig` = RAW Ed25519 over canonical_bytes; `owner_sig` = Contract A commit),
and tests/negative-controls. `verifyIngress()` is the crypto layer that derives the trace booleans;
`validate()` stays pure over those booleans.

### 2.5 Proof packages (Gate #4 — operability, not just correctness)
- `docs/proofs/proof-package-1.json` — **LIVE**: a real Tonkeeper 4.7.0 testnet signData/binary
  owner signature over THIS CAL's canonical bytes → `verifyIngress` → `validate` → `reduce` →
  `cal.finalized`. Capture provenance: `docs/proofs/captures/2026-06-01-tonkeeper-owner-sig.json`.
- `docs/proofs/proof-package-1-dryrun.json` — DRY-RUN machinery proof (generated keys).
- **Falsifiable verifiers** (each re-derives the package from its own contents through the live code,
  with a negative control that flips one signature byte → `ownerSigPresent: false`):
  `orchestrator/scripts/verify-proof.mjs` (TS) and `orchestrator-go/cmd/verifyproof` (Go). The Go
  verifier reproduces the TS-produced `cal_hash`, state roots, and event-log Merkle root
  byte-identically — cross-language parity on a real signed-CAL run.
- Honest scope boundary: trace step-results are the agent's *claim* (trace-only validator §4.1; MCP
  execution is non-deterministic, out of consensus scope); on-chain `sendTransaction`/`tx_hash` is
  `null` by design (out of PFC-1 scope §8.3).

### 2.6 Parity suites (TS reference == Rust == Go)
8 layers; Rust crates `*-rs/tests/parity.rs`, Go modules `*-go/parity_test.go`, TS `npm test` per
package. Run all: `scripts/repro.sh parity`.

---

## 3. Rust ingress — why deferred-by-constraint (not a deficiency)

The build environment forbids a C toolchain, build scripts, and proc-macros (musl-static + bundled
`rust-lld`). No no-build-script Ed25519 implementation is currently available to the Rust crates, so
the Rust node cannot perform the ingress signature verify. This is an **infrastructure** limitation,
not a model gap: the same authorization model is verified in two independent runtimes (TS + Go) with
cross-language parity and negative controls, and the Rust crate's *pure* `validate()`/`reduce()` are
parity-green over the booleans. Rust provides **no counter-example to the model**.

Resolution options (decided post-quiet-period, not now): adopt a pure-Rust no-proc-macro Ed25519, or
formally accept "2 of 3 runtimes" as sufficient ingress coverage for Freeze. Tracked in §6.

---

## 4. Advisory: Gate #2 ns/op baseline

Measured 2026-06-02 (`docs/notes/gate2-baseline-results.md`, Annex C.3). Eval-isolated harnesses in
all three runtimes. One systematic finding — `path_segment` (weight 2) is below band in all three
tree-walkers — is parked as `PATH_SEGMENT_WEIGHT_REVIEW`
(`docs/notes/tier2-path-segment-weight-review.md`). **No unit weight was changed**; per §C.4 the
counts are consensus-locked and wall-clock is advisory, so this is a deferred Tier-2 decision, not a
freeze blocker. Reproduce: `scripts/repro.sh bench`.

---

## 5. Reproducibility command set

No project-history knowledge required. `scripts/repro.sh <target>` (portable, no `make` needed) or
`make <target>`:

| Command | What it proves |
|---|---|
| `freeze-check` | fast gate — vectors NORMATIVE + both proof verifiers pass |
| `verify-proof` | Gate #4 — re-derive Proof Package #1 through the TS *and* Go nodes |
| `parity` | full cross-language parity (TS == Rust == Go, all 8 layers) |
| `vectors-check` | every golden vector + the tc-v2 manifest is NORMATIVE |
| `bench` | Gate #2 ns/op baseline (advisory) |

---

## 6. Deferred Register — explicitly NOT freeze blockers

| Item | Class | Disposition |
|---|---|---|
| **Rust ingress verification** | deferred-by-constraint | §3 — model confirmed in TS+Go; decide runtime coverage policy post-quiet-period |
| **`PATH_SEGMENT_WEIGHT_REVIEW`** | advisory Tier-2 | §4 — default is *no change*; decide at quiet-period close |
| **Node-integration follow-ups** | breadth | Go end-to-end proof DONE; remaining node breadth is non-consensus |
| **On-chain transport leg** (`sendTransaction`/`tx_hash`) | out of PFC-1 scope | §8.3 — post-Freeze (W5 external publication + Registry contract) |

All four are recorded as **not blockers for Freeze**. Anything that would change consensus semantics
during the quiet period is forbidden (spec wins; bug-fixes only).

---

## 7. Quiet-period rule

`freeze candidate → observation period → bug-fixes only → normative freeze`. During the quiet
period: no new normative changes to PFC-1 contents, no new contracts, no optimizations. The open
question is no longer *can the system prove a property* — it is *does it survive observation without
new defects or contradictions*.
