# Freeze Manifest — PFC-2 (Multisig v2.1) · DRAFT

**Date:** 2026-06-11 · **Status:** **DRAFT ruling / pre-registration.** NOT yet a freeze. The single open
gate is PP#4-B (`pp4-b-gate.md`); this manifest is written in advance so that, the moment PP#4-B SETTLES,
the ruling is a one-line status flip — not a fresh authoring task. Mirrors `docs/spec/freeze-manifest-pfc1.md`.

## 0. PFC-2 Status: **PENDING-FREEZE** (ruling held for PP#4-B)

PFC-2 (Multisig v2.1 — static M-of-N over the existing `OWNER_REQUIRED_ACTIONS` envelope, `pfc2-multisig-charter.md`)
is implemented, cross-language verified, and re-frozen on `pfc2/consensus`. Every consensus gate below is
satisfied; the only item outstanding is the on-chain demonstration (PP#4-B), the live step gated on
operator funding + key custody. **When PP#4-B is SETTLED, this status becomes `Consensus Freeze (ruled
<date>)` and v2.0.0 is cut** (the first merge of `pfc2/consensus` → `main`, charter §7).

## 1. Gate status

| Gate | Status | Evidence |
|---|---|---|
| **G-A. Semantics ratified** | ✅ **closed** | M0 charter + M1 semantics merged to `main` (PR #28) |
| **G-B. Validator quorum gate** | ✅ **closed** | M2 — `QUORUM_NOT_MET` / `INVALID_SIGNATURE_SET`, pure over `ownerSigners` |
| **G-C. Registry migration + bounds** | ✅ **closed** | M3 — `migrate` v1→1-of-1, `ownerRecordWellFormed`, `BAD_OWNER_RECORD` |
| **G-D. Owner-auth gas** | ✅ **closed** | M4 — `ownerAuthUnits(k)`, linear in verified signatures; operator path unchanged |
| **G-E. NORMATIVE vectors** | ✅ **closed** | M5 — 30 vectors (7 multisig + SC-4 anchor); re-promoted NORMATIVE after parity |
| **G-F. Cross-language parity** | ✅ **closed** | M6 (Rust) + M7 (Go): TS == Rust == Go byte-for-byte on all 30 vectors |
| **G-G. SC-4 behaviour-identity** | ✅ **closed** | `ms_migrated_1of1_equals_v1.output` == v1 `treasury_finalized.output`, asserted |
| **G-H. Re-freeze (freeze-gate green)** | ✅ **closed** | re-promotion `bac9716` — all 6 CI checks green; the moved values re-frozen |
| **G-I. Authorization-envelope proof (offline)** | ✅ **closed** | M8-R1 — quorum→FINALIZED+anchor / sub-threshold→QUORUM_NOT_MET, real envelopes |
| **G-J. On-chain anchor (PP#4-B)** | 🔒 **GATED** | the single live step; `pp4-b-gate.md` §2 prerequisites pending |

All consensus-logic gates (G-A…G-I) are satisfied. G-J is an operational demonstration, not a consensus
defect — by design it does not block the *logic* freeze, only the *ruling date* (mirrors PFC-1, where the
ruling followed the observation gate).

## 2. Normative inventory (what v2.0.0 freezes)

```
2.1 Surface that MOVED (Tier C, deliberately re-frozen vs PFC-1):
    - validator §8.2: single-owner gate → M-of-N quorum (QUORUM_NOT_MET / INVALID_SIGNATURE_SET)
    - registry: owner_pubkey → owners[] + threshold; v1→1-of-1 migration; §1.1 bounds
    - gas §9.2: + ownerAuthUnits(k) on owner-required actions (operator path byte-identical to v1)
    - golden vectors: validator/vectors/golden.json — NORMATIVE, 30 vectors, TS==Rust==Go

2.2 Surface UNCHANGED from PFC-1 (explicitly out of PFC-2, charter §4):
    - operator signature model (one operator_sig, raw Ed25519)
    - non-owner-gated actions (byte-identical gas/verdict to v1)
    - canonical/dsl/cal/reducer core beyond the owners[] record + quorum gate
    - jetton/nft (Tier M, shipped v1.1.0 — NOT part of PFC-2)

2.3 Integrity gate: scripts/repro.sh vectors-check (status NORMATIVE) + TS/Rust/Go parity jobs.
```

## 3. The ruling (TO BE STAMPED when PP#4-B SETTLES)

> **PFC-2 Consensus Freeze — ruled <date>.** The Multisig v2.1 surface (gates G-A…G-J all ✅) is frozen.
> The authorization envelope is demonstrated end-to-end: the offline proof (M8-R1) and the on-chain anchor
> (PP#4-B, tx `<hash>`, anchored root == `0x4a14…d4f0`). `pfc2/consensus` merges to `main` as **v2.0.0** —
> the first merge of the PFC-2 freeze line. PFC-1 (v1.x) stands unchanged beneath it; v2.0.0 is its own
> self-consistent freeze with regenerated evidence.

Until that stamp: PFC-2 is PENDING-FREEZE, `pfc2/consensus` stays a draft line (PR #29, DO-NOT-MERGE), and
no merge to `main` occurs.

## 4. Release checklist (post-PP#4-B, for v2.0.0)

```
[ ] PP#4-B SETTLED (pp4b-evidence.json, anchored root == offline root)
[ ] stamp §3 ruling with the date + anchor tx hash
[ ] final freeze-gate green on pfc2/consensus HEAD
[ ] annotated tag v2.0.0 on the merge commit (mirrors v1.0.0 / v1.1.0 release discipline)
[ ] merge pfc2/consensus → main (un-draft PR #29); PFC-1 freeze line untouched beneath
[ ] CHANGELOG + release notes: PFC-2 Multisig v2.1, the moved+re-frozen surface, SC-4 invariance
```

## 5. Related
- `pfc2-multisig-charter.md` / `pfc2-m1-multisig-semantics.md` — the chartered + designed surface.
- `pp4-multisig-proof.md` + `pp4-b-gate.md` — the PP#4 proof + the broadcast gate that unblocks §3.
- `docs/spec/freeze-manifest-pfc1.md` — the PFC-1 freeze this mirrors and rides above.
