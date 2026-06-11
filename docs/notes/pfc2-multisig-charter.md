# PFC2-M0 Charter — re-anchoring the PFC-2 consensus line on Multisig v2.1 (v2.0.0)

**Date:** 2026-06-11 · **Status:** charter / pre-registration (no code). **Tier C — this MOVES the
Freeze Surface.** Opens the *genuine* PFC-2 freeze line above PFC-1 (`pfc1-consensus-freeze`, v1.0.0).
Ratify before any PFC-2 code. **First verb / change: multi-owner authorization (`owners[]` + `threshold`)
for the existing `OWNER_REQUIRED_ACTIONS` envelope.**

## 0. Why this supersedes the original PFC2-0 charter

`pfc2-charter.md` (PFC2-0) opened PFC-2 with `wallet.send_jetton` as the first Tier-C verb. That premise
was **falsified** (`pfc2-jetton-reclassification.md`): the frozen consensus surface already finalizes
`send_jetton` — the verb is pre-registered in the §2.3 taxonomy, its `jetton_access` scope is frozen, and
validator/reducer/gas treat it generically. Jetton was therefore a **Tier-M publication feature** and
shipped as **v1.1.0** (J1 track, `j1-jetton-publication-charter.md`, PP#3 SETTLED live, freeze-gate
byte-identical). PFC-2 as a *real* freeze-line move was left **reserved for Multisig v2.1**
(`roadmap-v1.x.md` Tier C). This charter claims that reservation.

The discriminator that jetton failed and multisig passes:

```
A change is Tier C ⟺ it moves a `freeze-gate` VALUE (vectors-check + verify-proof-ts/go).
  jetton:   registry/scope/validator/reducer/gas already produce its outputs → VALUES unchanged → Tier M.
  multisig: the owner-authorization envelope (registry shape + §8.2 quorum + signed-CAL form + gas)
            has NO multi-owner representation today → VALUES *must* change → Tier C.
```

## 1. What makes this Tier C (read this first)

Every post-release item since v1.0.0 (M1–M3, A1, A2, **and J1**) held one invariant: **`freeze-gate`
byte-identical** — the root values never moved. **PFC-2 inverts that, for real this time.** Multisig
changes the *authorization model* — the registry's per-agent owner representation, the §8.2 signature
gate, the canonical form of a signed CAL, and the gas cost of owner verification. Those are all Freeze
Surface, and their **values** change by design.

```
v1.x + J1 (Tier M):  freeze-gate VALUES unchanged → ride pfc1-consensus-freeze, MINOR/PATCH
PFC-2  (Tier C):     freeze-gate VALUES change     → a NEW freeze line, regenerated evidence, MAJOR 2.0.0
```

The CI `freeze-gate` job goes *green again* only once PFC-2's evidence is **regenerated** (new vectors
promoted to NORMATIVE, a new Proof Package reproducing in TS+Go) — it asserts *internal consistency*, not
equality with PFC-1. Until that regeneration lands, PFC-2 cannot merge to `main` (branch protection holds
— by design). PFC-2 reaches `main` only as **v2.0.0**, with its own self-consistent freeze.

## 2. The frozen model PFC-2 changes (grounding)

Today's authorization is strictly **single-owner**:

| Layer | Single-owner (frozen v1.0.0) | Evidence |
|---|---|---|
| Registry (per agent) | one `owner_pubkey: string` | `validator/src/validate.ts` reads `registry.agents.<a>.owner_pubkey` |
| §8.2 gate | action ∈ `OWNER_REQUIRED_ACTIONS` ⇒ require **one** `owner_sig` from that key | `OWNER_REQUIRED_ACTIONS` (`dsl/src/taxonomy.ts`); `isOwnerRequired` |
| Trace | `ownerSigPresent: bool` (node's single-key verdict) | `validate()` is pure over the trace flag |
| Signed CAL | a single `owner_sig` | canonical signed-CAL form |
| Gas | one owner Ed25519 verification (flat) | `cal-gas/*` |

`OWNER_REQUIRED_ACTIONS` is the **exact** envelope PFC-2 generalizes — the set of actions that today need
one owner co-signature will, under v2.1, need a **quorum** of owner co-signatures. No verb is added or
removed; the *authorization predicate* over the existing set changes.

## 3. Design review — the smallest multi-owner change that justifies a new freeze

A new freeze is expensive. The first PFC-2 increment must be the **smallest** change delivering real
multi-owner capability that isolates cleanly. Candidate slices, narrowest first:

| Candidate | Capability | Surface touched | Verdict |
|---|---|---|---|
| **Static M-of-N quorum** (`owners[]` + `threshold` fixed at agent registration; 1-of-1 == today) | multi-owner authorization for the existing owner-required envelope | registry owner field + §8.2 quorum predicate + signed-CAL `owner_sigs[]` + per-signature gas + vectors | **CHOSEN** |
| + dynamic owner rotation (`agent.add_owner` / `remove_owner` / `set_threshold`) | live membership/threshold changes | adds NEW governance verbs + their own auth (chicken-and-egg: who authorizes a threshold change?) | **defer** — its own PFC-2 increment once static quorum lands |
| Weighted / hierarchical multisig | per-owner voting weight, nested approval | a richer predicate; large blast radius, low first-demand | **defer** — PFC-3 candidate |

**Ruling: static M-of-N quorum first.** It is the largest authorization-model gain that does **not** add
any new verb and does **not** introduce the rotation chicken-and-egg problem. Single-owner v1.0.0 becomes
the degenerate `1-of-1` case (`owners = [owner_pubkey]`, `threshold = 1`) — behaviourally equivalent for
existing agents, yet its registry encoding and signed-CAL form change, which is *exactly* what makes it
Tier C (the values move, deliberately). Rotation and weighting are explicitly **out** of this increment.

## 4. Scope

### IN (PFC-2, first increment — static M-of-N)
- **Registry shape:** per-agent `owner_pubkey: string` → `owners: string[]` (canonically ordered) +
  `threshold: int`, with `1 ≤ threshold ≤ len(owners)` and `owners` non-empty, distinct. Migration rule:
  a v1 single-owner agent is `{owners:[owner_pubkey], threshold:1}`.
- **Signed-CAL form:** `owner_sig` → `owner_sigs[]` (canonically ordered by signer pubkey; distinct
  signers; each verifiable against a member of `owners`).
- **§8.2 quorum gate:** for `action ∈ OWNER_REQUIRED_ACTIONS` (or bounded-mode), require the count of
  **distinct valid** owner signers (⊆ `owners`) to be `≥ threshold`; else fail. New failure reason
  **`QUORUM_NOT_MET`** (vs reusing `CAPABILITY_DENIED`) — to be ruled in PFC2-M1.
- **Trace:** `ownerSigPresent: bool` → `ownerSigners: pubkey[]` (the node's verified-signer set); `validate()`
  stays pure over it (counts distinct members, applies threshold).
- **Gas:** owner verification cost becomes a function of signatures presented (k Ed25519 checks, not 1) —
  a §9 per-signature weight. **Operator_sig model is UNCHANGED** (still exactly one operator signature).
- Regenerated **NORMATIVE** golden vectors covering quorum pass/fail/degenerate-1-of-1 in **TS + Rust + Go**.
- **Proof Package #4** — a real testnet demonstration that a quorum-authorized CAL publishes and finalizes
  (the on-chain effect still rides the W5 operator path; PP#4 proves the *authorization envelope*, not a
  new on-chain primitive — see Open Questions).
- An explicit **`pfc2-consensus-freeze`** ruling on the regenerated surface.

### OUT (later PFC-2 increments / PFC-3)
- Dynamic owner rotation (`add_owner`/`remove_owner`/`set_threshold`) and the meta-authorization of
  threshold changes. Weighted/hierarchical multisig. `wallet.send_nft` is already Tier-M (rides J1's
  machinery). Promoting the M2 reconciliation contract to *normative*. Agentic-Wallet SBT.
- Any change to the **operator** signature model (single operator_sig stays; multisig is owner-side only).

## 5. The PFC-2 path (mirrors the road to v1.0.0, on the new line)

```
PFC2-M0  Charter (this) ........................ ratify, no code
PFC2-M1  Semantic design — static M-of-N ....... registry shape, owner_sigs[] form, quorum predicate,
                                                  QUORUM_NOT_MET vs CAPABILITY_DENIED, 1-of-1 migration,
                                                  canonical ordering, PP#4 shape (the Open Questions, ruled)
PFC2-M2  Validator .............................. §8.2 quorum gate over ownerSigners[] + threshold
PFC2-M3  Reducer / registry ..................... owners[]/threshold state + migration of v1 snapshots
PFC2-M4  Gas ................................... per-signature owner-verification weight (§9)
PFC2-M5  Vectors ............................... golden vectors (pass / QUORUM_NOT_MET / 1-of-1) → NORMATIVE
PFC2-M6  TS reference + PFC2-M7 Go reference .... parity (Rust rides the same vectors)
PFC2-M8  Proof Package #4 ...................... real testnet quorum-authorized finalization (gated, like PP#2/#3)
PFC2     Freeze decision ........................ explicit pfc2-consensus-freeze ruling → v2.0.0
```

Each stage is its own PR with a pre-registered acceptance, exactly as M1–A2 and J1 were — but on the
PFC-2 freeze line, with the inverse freeze-gate discipline (values move and are *re*-frozen, not held).

## 6. Success criteria (PFC-2 first increment)

```
SC-1  static M-of-N quorum defined + validated (validator + reducer + gas) — TS reference green
SC-2  cross-language parity: TS == Rust == Go on the quorum vectors (pass / QUORUM_NOT_MET / 1-of-1)
SC-3  golden vectors promoted to NORMATIVE (regenerated freeze surface)
SC-4  1-of-1 degenerate case: a migrated v1 single-owner agent finalizes identically in BEHAVIOUR
      (terminal stage + event sequence) — only encoded values differ
SC-5  Proof Package #4: a quorum-authorized CAL publishes + finalizes on testnet; the authorized action
      == the on-chain effect
SC-6  the OPERATOR signature model + every non-owner-gated path are UNCHANGED (blast radius bounded to
      the owner-authorization envelope)
SC-Freeze  an explicit pfc2-consensus-freeze ruling; freeze-gate green on the REGENERATED evidence
```

SC-Freeze is the **inverse** of v1.x/J1's: the values move, deliberately, and are re-frozen — not held.
SC-4 + SC-6 are the *blast-radius fences* — they keep "generalize single-owner to M-of-N" from leaking
into the operator path or changing the behaviour of existing agents.

## 7. Branch policy

This charter (docs-only, no Freeze-Surface change) lives on `pfc2/multisig-charter` and merges to `main`
to pre-register the line. The **code** line opens at PFC2-M1 on a dedicated **`pfc2/consensus`** freeze
branch (NOT a `post-release/*` maintenance branch) — because it modifies the Freeze Surface and must
regenerate evidence before it can be self-consistent. The eventual merge to `main` is the **v2.0.0**
release with its own freeze, exactly as v1.0.0 merged the PFC-1 line.

## 8. Failure taxonomy

On the PFC-2 line a divergence is a **consensus-design** signal, resolved BEFORE the freeze:
- **Parity divergence** (TS≠Rust≠Go on quorum vectors) — a reference/codec bug; fix before promoting vectors.
- **Migration drift** (a 1-of-1 migrated agent changes BEHAVIOUR, not just encoding) — violates SC-4;
  the migration rule is wrong → re-derive before freeze.
- **Blast-radius leak** (a non-owner-gated path or the operator model changes) — violates SC-6; the slice
  is no longer isolated → re-scope.
- **PP#4 effect mismatch** (quorum-authorized action ≠ on-chain effect, or a sub-threshold CAL finalizes)
  — a gate/codec gap; resolved on the line before the freeze ruling.
None of these is a defect of the *frozen v1.0.0* line — PFC-1 stands; PFC-2 is a new, parallel freeze.

## 9. Open questions for PFC2-M1 (semantic design) to rule

> **RULED in `pfc2-m1-multisig-semantics.md` (2026-06-11):** (1) new `QUORUM_NOT_MET` *and* a second code
> `INVALID_SIGNATURE_SET` (malformed set) — checked before quorum; (2) `owner_sigs[]` ordered ascending by
> matched owner pubkey, duplicates rejected pre-hash; (3) PP#4 proves the auth envelope only (W5 single-key);
> (4) `1 ≤ threshold ≤ owners.length ≤ MAX_OWNERS=16`, enforced at the reducer. M1 is the normative source.


1. **`QUORUM_NOT_MET` vs `CAPABILITY_DENIED`** — new reason code (clearer telemetry, new vector) or reuse
   (smaller surface)? Lean: new code; multisig telemetry needs to distinguish "wrong/insufficient signers"
   from "no capability".
2. **Canonical ordering of `owner_sigs[]`** — by signer pubkey ascending (deterministic hash). Confirm
   duplicate-signer rejection happens *before* hashing (a CAL with a repeated signer is malformed, not
   merely sub-quorum).
3. **PP#4's on-chain meaning** — TON wallet contracts (W5) are single-key; CAL multisig is an
   *authorization-envelope* concept (who authorizes the agent's action), not an on-chain multisig wallet.
   PP#4 must therefore prove the **authorization gate** (k owner sigs → finalize), with the on-chain effect
   still published via the operator's W5 path. Confirm this framing or escalate to an on-chain multisig
   contract (much larger scope, likely PFC-3).
4. **Threshold bounds at registration** — `1 ≤ threshold ≤ len(owners)`; reject `threshold == 0` and
   `threshold > len(owners)` at the reducer (agent.register / migrate), not the validator.

## 10. Related
- `pfc2-charter.md` (PFC2-0) — the SUPERSEDED jetton-first charter this re-anchors; kept for audit trail.
- `pfc2-jetton-reclassification.md` — the Tier-C/Tier-M discriminator that freed the PFC-2 slot for multisig.
- `roadmap-v1.x.md` — Tier C reserves Multisig v2.1 as the genuine PFC-2 first verb.
- `release-governance.md` — the freeze-line / freeze-adjacent governance PFC-2 obeys.
- `freeze-manifest-pfc1.md` — the PFC-1 Freeze Surface inventory PFC-2's changes are measured against.
- `proof-package-2-spec.md` — the PP#2 pre-registration discipline PP#4 mirrors for the quorum envelope.
