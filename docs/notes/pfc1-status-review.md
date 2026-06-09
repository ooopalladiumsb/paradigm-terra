# PFC-1 status review — Consensus Freeze ruling

**Date:** 2026-06-03 (Candidate decision) → 2026-06-06 (Freeze ruling) · **Branch:**
`feat/tc-v2-sig-verify-v1` · **frozen state HEAD:** `2fd4b8a` (local).

**Purpose.** A project-level decision artifact, written *before* the next line of code. It does two
things: (1) makes the **Consensus Freeze ÷ Production Readiness** stratification official, and (2)
records the freeze-promotion decision and what gates the final promotion. It supersedes the
calendar-only freeze criterion (Gate #5) with an evidence-based one, consistent with the OVT charter
(`operational-validation-track.md`).

---

## 0. Freeze Ruling (2026-06-06)

> **PFC-1 Consensus Freeze is fixed.** All known remaining risks are classified as **Integration
> Reality Risk** or **Production Readiness Risk**. **No known open Freeze Surface risk remains.**

- **Scope of the ruling.** This freezes the **consensus core** (§2). It is *not* a statement of
  product, mainnet, or launch readiness — the deliberate distinction the project has held throughout
  (see §1). "Frozen" means: no further free editing of the Freeze Surface; changes go through
  compatibility review.
- **Basis.** All promotion criteria (§4) are ✅: the `canonical_to_inner` model review found the one
  residual model question (tick↔wall-clock) to be publication-layer, not core; the Annex F OutList
  reference impl + invariants pass; reproducibility hardening landed; and across the entire OVT no
  Freeze Surface defect was found — the charter's "most important" criterion (criterion 7).
- **What would have blocked it (and did not).** Only a belief that PP#2 could force a change to the
  CAL model / validator / reducer / canonicalization / economics. Every risk surfaced in OVT lay in
  the publication layer / `valid_until` mapping / W5 integration / external transport — none requires
  a Freeze Surface change.
- **Frozen state:** HEAD `2fd4b8a`. **Recorded across:** this §0, `freeze-manifest-pfc1.md §0/§1`,
  and `README.md`.
- **Post-freeze open items** (do not block the freeze; tracked at §3 / §5 / the freeze manifest §6):
  ✅ PP#2 testnet validation / H3.1 live W5 integration — **DONE 2026-06-06** (ton-testnet, verdict
  A.SUCCESS, `tx_hash 8d4b96e6…`, effect == CAL action; `proof-package-2-spec.md §0`). Remaining:
  H3.5 live external observer, OVT-SG checkpointing, broader verbs, and Production Readiness at large.

---

## 1. The stratification (now official)

```
Phase A — Consensus Freeze Surface     immutable core: canonical · dsl · cal · validator ·
        ↓                              reducer · gas · ingress · the co-signature model
Production Readiness Track             everything that rests on the frozen core but is not
                                       consensus-binding: on-chain publication, soak daemons,
                                       checkpointing, ecosystem integration, standardization
```

The two risk classes this review turns on:

| Risk class | Meaning | Status |
|---|---|---|
| **Freeze Surface Risk** | the consensus math / state machine / economics is *wrong or non-deterministic* | **practically retired** (§2) |
| **Integration Reality Risk** | the TON interaction model differs from what the frozen core assumes | **open** — only Proof Package #2 can falsify it (§3) |

These are different risks. The first is what a freeze must retire; the second is an integration
question that, by construction, can only be fully answered on-chain. Conflating them is what kept
Gate #5 a hollow calendar proxy.

---

## 2. Freeze Surface Risk — retired

Reproduce any row with `scripts/repro.sh <target>`.

| Evidence | Target | Status |
|---|---|---|
| Canonical encoding (TS==Rust==Go, diff-fuzzed) | `parity` / `vectors-check` | ✅ |
| DSL · validator · reducer · gas (golden, parity-locked) | `parity` / `vectors-check` | ✅ |
| Economic model (escrow §9.3 / spam-fee §9.4 / gas §9.2) | `ovt3-griefing` | ✅ |
| TS↔Go determinism, point-wise | `parity` | ✅ |
| TS↔Go determinism, **continuous** (no drift under load) | `ovt3-soak` | ✅ (H3.2/H3.3) |
| Ingress → validate → FINALIZED on a real signed CAL | `verify-proof` | ✅ (Gate #4, PP#1 LIVE) |
| Autonomous agent loop (no manual stitching) | `ovt1` | ✅ (H1.4) |
| Crash → replay → identical STATE_ROOT | `ovt2` | ✅ (OVT-2) |
| Griefing bounded (economics + structural DSL limits) | `ovt3-griefing` | ✅ (H3.4) |
| `path_segment` weight review | — | ✅ closed → Option 1 (`tier2-path-segment-weight-review.md`) |
| **No Freeze Surface defect found during OVT** (criterion 7) | all of the above | ✅ |

Criterion 7 is the OVT charter's "most important" gate, and it holds. The remaining OVT items (§3)
are *ecosystem* correctness, not *core* correctness — none of them re-tests a Freeze Surface axiom;
they exercise the boundary with the outside world.

**Caveat for an external reproducer (feeds H3.5):** only the **golden vectors** and **Proof Package
#1** reproduce *fixed roots* (and the Go ports already reproduce them byte-for-byte). The generative
OVT scripts (`ovt1`, `ovt2`, `ovt-sg`, `ovt3-soak`) mint **fresh keypairs per run**, so they verify
*properties* (FINALIZED, crash==replay, 0 divergences, bounded griefing), not fixed hashes. The repro
guide must state this split; a deterministic-seed mode is Production-Readiness work (§5, step 3).

---

## 3. Integration Reality Risk — the dominant residual

Two OVT-3 items remain, both at the network boundary:

- **H3.1 — Proof Package #2:** publish a validated CAL on-chain as a `sendTransaction(W5 external)`,
  testnet `tx_hash ≠ null`, externally verifiable. This is the **last opportunity to falsify the
  frozen core** against reality. Precedent that such mismatches are real: PP#1 surfaced the
  `cal_hash string ≠ canonical_bytes(cal)` signing gotcha. If the W5 ↔ CAL mapping reveals a
  structural gap, that is OVT doing its job — and it would re-open the freeze.
- **H3.5 — external observer:** an independent party reproduces a live node's roots. The offline half
  (clean-room reproduction of the *pinned* artifacts) is doable now; the live half needs a network.

### 3.1 Honest state of the "Annex F codec" (correcting the roadmap shorthand)

The H3.1 row references an "Annex F / `canonical_to_inner` codec." Verified against the repo, that
codec is **not specified** — it exists only as a Future-Work sketch in
`ton-connect-ingress-design.md §6.1`, with an **open design decision** (emit the CAL's steps as a W5
`OutList` — one `SendMessage` per step — vs an `ActionList` of extension actions) and a dependency on
an on-chain Registry contract (also future work). Exec-spec §8.3 explicitly scopes
`sendTransaction(W5 external)` **out** of the frozen surface.

Consequence for what is *offline-doable*:
- **Designing + specifying `canonical_to_inner` is the real model-mismatch probe** — forcing CAL
  `action`/`steps` into a W5 `InnerRequest` is exactly where a CAL↔TON structural gap would first
  appear, and it is fully offline. High value.
- **There is no offline test oracle for it.** The only captured external (`interop/observations/
  2026-05-31-mytonwallet.md`) decodes to a *wallet-deploy* external (StateInit, 25 cells), **not** a
  `canonical_to_inner` encoding of one of our validated CAL effects. So the codec can be unit-tested
  for *internal* invariants (determinism, W5 cell well-formedness per the V5 spec, envelope
  round-trip) but **cannot be validated against "the chain accepts our encoding of our effect"
  offline.** That validation is intrinsically on-chain (H3.1-live).

So "hold the freeze until PP#2 is fully done offline" is **not achievable** — PP#2's load-bearing
proof is on-chain. The achievable offline slice is *the codec design/spec + an internally-checkable
implementation*, which de-risks H3.1 as far as is possible without a network.

---

## 4. Decision

**PFC-1 is declared a `Consensus Freeze Candidate` as of 2026-06-03.**

- Freeze Surface Risk is retired (§2); the core is treated as immutable from here.
- H3.1-live, H3.5-live, and OVT-SG checkpointing are **moved to the Production Readiness Track**.
  They are *required before launch*, **not** required before the freeze.
- **Final promotion** (`Candidate → Consensus Freeze`) is gated on completing the offline slice that
  can still move the decision: the `canonical_to_inner` **codec design/spec** (§3.1) + reproducibility
  hardening (§5, step 3). Rationale: the codec design is the only remaining offline action with the
  *power to falsify the frozen core*; checkpointing and further local refactoring have no such power.

This is the intermediate path: not "freeze-now-blind," not "hold-for-a-PP#2-that-can't-finish-
offline," but "Candidate now → resolve the last offline falsification surface → promote."

### Promotion criteria (`Candidate → Consensus Freeze`)

1. ✅ `canonical_to_inner` design decision resolved and reviewed for model gaps —
   `cal-to-w5-mapping-review.md` (OutList-vs-ActionList was a false dichotomy → verb-class dispatch;
   one model finding, tick↔wall-clock, ruled a publication-layer constraint, freeze intact).
2. ✅ `canonical_to_inner` reference implementation (OutList arm) passing offline invariant tests —
   `orchestrator/src/w5/canonical-to-inner.ts` + `test/w5-codec.test.ts` (10/10; suite 25/25).
3. ✅ Reproducibility hardening landed — `reproducibility-guide.md` + `scripts/setup.sh` (clean-room
   bootstrap in dep order) + `OVT_SEED` deterministic-seed mode + the deterministic-root vs
   property-target split documented (and pinned PP#1 roots to diff against).
4. ✅ (so far) No Freeze Surface defect surfaced by 1–3 (the one finding was publication-layer).

H3.1-live (testnet `tx_hash`) and H3.5-live remain Production-Readiness gates *after* promotion; a
failure there would still re-open the freeze (criterion 7 is permanent), but it does not block the
Candidate→Freeze step given the offline ceiling in §3.1.

---

## 5. Forward plan

```
1. ✅ (this document)      Status review + Consensus Freeze Candidate decision
2. ✅ (offline)            canonical_to_inner codec — model review (false dichotomy → verb-class
                           dispatch) + OutList-arm reference impl + 10 offline invariants
3. ✅ (offline)            reproducibility hardening — reproducibility-guide.md, scripts/setup.sh,
                           OVT_SEED deterministic-seed mode, deterministic-root vs property split
4. → PROMOTION DECISION    Candidate → Consensus Freeze — ALL offline criteria (#1–#4) now ✅; this
                           step is the architect's call to make (the offline ceiling §3.1 is reached)
5. (deferred → Prod-Ready) OVT-SG checkpointing (when the long-running daemon is built)
6. (network, when avail.)  PP#2 live leg (H3.1) + external-observer live reproduction (H3.5)
```

**All offline promotion criteria (#1–#4) are satisfied.** Nothing offline remains that can move the
freeze decision; the next action is the architect's `Candidate → Consensus Freeze` ruling, after
which all residual risk is network-side (H3.1/H3.5-live).

## 6. Related

- `operational-validation-track.md` — OVT charter + per-hypothesis status (the evidence behind §2).
- `freeze-manifest-pfc1.md` — the normative inventory frozen at this candidate.
- `ton-connect-ingress-design.md` §6 — the `canonical_to_inner` / W5-external Future-Work sketch.
- `tier2-path-segment-weight-review.md` — closed → Option 1 (griefing-data-backed).
