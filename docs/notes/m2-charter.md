# M2 Charter — Registry reconciliation (settlement observation for the proven `send_ton` path)

**Date:** 2026-06-09 · **Status:** charter / pre-registration (no code). Post-release v1.x maintenance
line, **Tier M** (above the Freeze Surface). Follows M1 (`release-gate.md` CI findings; `rust-parity`
promoted to required). Ratify this charter **before** the first M2 PR — same discipline as the PP#2
pre-registration: pin scope, success criteria, and failure taxonomy in advance so the verdict can't be
rationalized post-hoc.

## 0. Architect ruling (the boundary this charter encodes)

Ruled 2026-06-09. M2 is **APPROVED FOR CHARTER** with:

```
Role:           Registry reconciliation layer
Scope:          wallet.send_ton only
Mode:           offline-first (network leg gated, non-blocking)
Tier:           M (maintenance)
Freeze Surface: immutable
```

M2 closes the §6.4 gap in `cal-to-w5-mapping-review.md` — **emission ≠ settlement**: TON settles each
emitted message in a *separate, asynchronous* transaction, so `cal.finalized` means "validated + actions
emitted," **not** "all downstream effects landed." PP#2 proved the *emission* leg of `send_ton`
end-to-end (verdict A.SUCCESS, tx `8d4b96e6…`). M2 adds the **settlement-observation** leg: an on-chain
Registry that records settlement facts plus an off-chain reconciler that correlates
`CAL → tx/effect → registry record`. The Registry **observes and records; it decides nothing about
consensus** (the PR-1 observer discipline — observers have no authority over the frozen core).

## 1. The one rule (why each boundary is mechanical, not taste)

Per `roadmap-v1.x.md`, an item's tier is decided by *would `freeze-gate` move?* M2 is Tier M iff it adds
**no** normative artifact and touches **none** of `cal / validator / reducer / canonicalization /
economics`. Three tripwires would silently flip M2 into Tier C (PFC-2 → 2.0.0) — the charter forbids all
three:

1. **New value-verbs (jetton/nft, nested TEP-74/62 bodies)** — roadmap-classified Tier C. **OUT.**
2. **Registry-mutation verb semantics (`agent.register` / `capability.update` …)** — would need
   validator/reducer/gas ⇒ Freeze Surface. **OUT.**
3. **Promoting the Registry contract to *normative*** ("Tolk normative on-chain artifacts" = Tier C).
   The M2 contract is a **non-normative operational DRAFT**. **OUT** of normative status.

## 2. Scope

### IN (M2, Tier M)
- Registry reconciliation contract — **non-normative operational DRAFT** (Tolk/FunC), settlement-record
  role only.
- Settlement observation: the live external-message leg observed/correlated for `send_ton`.
- Offline verification: contract builds reproducibly + reconciliation tested against internal invariants.
- Testnet deployment — an **optional, gated** stage (M2-C); never blocks M2-A/M2-B.
- Failure taxonomy, operator workflow, observability.

### OUT (Tier C / later — each would open a new freeze line)
- New verb classes · jetton · NFT · any expansion of `V0_1_0_ENCODABLE` beyond `wallet.send_ton`.
- Validator / reducer / gas-model changes.
- Normative contract promotion.
- Capability-semantics evolution · agent-registration-semantics evolution.

**Verb invariant.** While `V0_1_0_ENCODABLE = { wallet.send_ton }` holds, M2 operates strictly inside
that set. Any extension of the encodable set ⇒ **PFC-2 ⇒ new freeze line ⇒ v2.0.0** — out of M2 by
construction.

## 3. Stages (offline-first; the network leg is gated, not on the critical path)

```
M2-A  Offline contract + reconciliation specification
        - Registry contract (Tolk/FunC) reproducibly buildable; records settlement facts
          (cal_hash/nonce ↔ external_message_hash ↔ tx_hash ↔ observed effect ↔ status).
        - canonical_to_inner / ir_to_boc UNCHANGED — M2 consumes their send_ton output, does not extend it.
M2-B  Offline reconciliation tests
        - the reconciler classifies each send_ton settlement: settled | missing | delayed | mismatched
          (§4) against internal invariants, with no network (replay fixtures + simulated chain effects).
M2-C  Testnet deployment  [GATED on real testnet access — optional, non-blocking]
        - deploy the Registry to ton-testnet; correlate a live send_ton (cf. PP#2-B) end-to-end into a
          registry record. If access is unavailable, M2 still closes on M2-A + M2-B.
```

## 4. Success criteria (M2 PASSES iff all hold; pinned in advance)

```
SC-1  Registry contract builds reproducibly (deterministic artifact; clean-room buildable like the freeze set).
SC-2  Offline reconciliation detects, for a send_ton settlement, each class:
        settled · missing · delayed · mismatched effect.
SC-3  send_ton settlement is correlatable end-to-end:  CAL → tx/effect → registry record.
SC-4  No Freeze Surface movement (no cal/validator/reducer/canonicalization/economics edit).
SC-5  freeze-gate remains byte-identical (vectors NORMATIVE + Proof Package #1 reproduce in TS and Go).
```

SC-4/SC-5 are the Tier-M guarantee: they are checked the same way CI checks the freeze. M2-C (testnet)
is **not** an SC — its absence does not fail M2; its presence strengthens SC-3 from simulated to live.

## 5. Failure taxonomy (decided in advance — classify before reacting)

Because the Registry **only observes**, M2 cannot move the Freeze Surface by construction. A discrepancy
surfaced by reconciliation is therefore one of two things — never a freeze defect:

- **Reconciliation-layer defect** (our contract/reconciler bug: bad correlation, wrong status, mis-built
  record): fix in M2 code, freeze intact. This is the expected class for any SC-2/SC-3 miss.
- **Settlement reality** (a real `missing` / `delayed` / `mismatched` on-chain settlement of an
  already-emitted, already-proven `send_ton`): this is **data**, the exact signal M2 exists to capture —
  it is recorded and surfaced to the operator, not treated as a consensus event.

**Discriminator:** did the reconciler correlate faithfully? An unfaithful correlation ⇒ our bug
(reconciliation-layer). A faithful correlation that still shows a non-`settled` status ⇒ a true
settlement observation (data). Neither path can re-open PFC-1: `send_ton` *emission* semantics are
already proven (PP#2) and frozen; settlement is async TON reality the Registry merely records.

## 6. Branch policy

Working branch: **`post-release/m2-registry-reconciliation`** (off `main`, like M1). M2-A/M2-B land on
it as ordinary operational PRs up to `main` (now branch-protected: 4 required checks + `enforce_admins`).
M2-C's testnet artifacts attach only when real testnet access exists (the PP#2 §5 rule) and never gate
the offline close.

## 7. Related
- `cal-to-w5-mapping-review.md` — §6.4 emission-vs-settlement gap (the risk M2 closes); §4 verb table.
- `proof-package-2-spec.md` — PP#2 (the proven `send_ton` emission leg M2 observes); pre-registration discipline.
- `roadmap-v1.x.md` — Tier M / Tier C split (the boundary §1/§2 encode); M2 = NEXT after M1.
- `release-gate.md` — M1 close + the required-checks gate M2 PRs ride.
- `pr1-closure-report.md` — the observer discipline ("observers decide nothing") M2's Registry inherits.
