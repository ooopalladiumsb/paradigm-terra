# PFC-3A — Governance Authority charter (R0)

**Date:** 2026-06-13 · Branch `feat/pfc3a-charter` · The first PFC-3 sub-line (`pfc3-charter.md` §2),
Framing A: **on-chain voting + tally · off-chain execution**. Charter-first / R0 — this fixes the
**Governance Freeze Surface** (the 7 points from `pfc3-charter.md` §3) BEFORE any contract. No code, no
op-codes, no ABI here — only *what becomes a source of truth*.

## The transition

```
Governance View (v2.3.0, Stage-A)        Governance Authority (PFC-3A)
  reflects an off-chain-decided tally  →   the tally/outcome is DECIDED on-chain and HONORED off-chain
```

**The new source of truth: the vote tally + finalized outcome.** In Framing A, votes are cast and tallied
on-chain (the authority); the off-chain kernel READS the finalized outcome and EXECUTES the amendment
(applies it to consensus state). Execution stays off-chain; the *decision* moves on-chain.

## Grounding — the model is already normative (Constitution §VII)

PFC-3A does NOT invent a voting model; it implements the **frozen Constitution §VII**:
```
EffectiveVotePower = sqrt(SlotPrice) · JurisdictionAlignment · (1 / ClusterAffinity)
   JurisdictionAlignment ∈ (0,1] · ClusterAffinity ∈ [0.1,1.0]
Tiers:  Tier 1  60% supermajority · 30-tick timelock · HYBRID slot+PTRA voting
        Tier 2  75% supermajority · 35% quorum · 90-tick · slot-only
        Tier 3  90% supermajority · 50% quorum · ~1yr · slot-only
Capture Guard:  ≥3 FOR-votes in 30 days ⇒ ×0.1 weight for 90 days (slot- and PTRA-weights alike)
Cluster detection:  deterministic on-chain fn (≥80% identical voting pattern / 30d), run by the validator
```
So the §3 model is **ratified by the constitution** (quadratic NFT-slot, not 1-token-1-vote / delegated).
The genuine R0 decision is **PHASING** (§3 below): the full model at once, or a core-first freeze.

## The 7-point NEW FREEZE SURFACE (Governance)

### 1. STATE (the new on-chain sources of truth)
```
Proposal      { id, tier∈{1,2,3}, summary_en, payload_hash, timelock_ticks, created_tick }
Vote          { proposal_id, voter (NFT slot id; + PTRA account for Tier-1 hybrid), choice∈{for,against}, power }
Tally         { proposal_id, for_power, against_power, total_eligible_power }
Outcome       { proposal_id, status∈{open,passed,rejected}, finalize_tick }   ← the authoritative result
VotingPowerSource (the line's hardest question):  NFT governance slots (sqrt(SlotPrice)·JurisdictionAlignment·
                  1/ClusterAffinity); Tier-1 adds a PTRA-weighted vote (hybrid). Slot ownership + SlotPrice
                  are themselves on-chain facts the tally reads.
```

### 2. EVENTS (normative list — no op-codes/ABI here)
```
ProposalCreated   (a tier-N proposal opens, with its timelock)
VoteCast          (a slot/PTRA voter casts for/against with computed power; once per voter per proposal)
ProposalFinalized (at/after timelock + threshold met → outcome decided, immutable)
```

### 3. TRANSITIONS (the decision rules — the most dangerous section) — PHASING TO RATIFY
The model is Constitution §VII (above). The R0 choice is how much of it the FIRST freeze includes:
```
3A-core (RECOMMENDED first freeze): slot-quadratic power (sqrt(SlotPrice)) · per-tier supermajority+quorum
        · timelock · immutable finalization · no-double-vote.  (the minimal honest Governance Authority)
3A-modifiers (scoped follow-ons, each its own increment, NOT the first freeze):
        JurisdictionAlignment · ClusterAffinity + Capture Guard · Tier-1 hybrid PTRA voting
3A-full: all of the above in the first freeze (bigger Freeze Surface, higher risk)
```
Ratify ONE phasing. Each modifier added later is itself a re-freeze (it changes the power/threshold model).

### 4. INVARIANTS (must always hold; normative)
```
- no double vote        : a voter (slot id / PTRA account) counts once per proposal
- monotonic tally       : votes only accrue while open; no retraction after finalize
- immutable outcome     : a finalized Outcome never changes
- deterministic outcome : identical {votes, slot state, tick} ⇒ identical Outcome on every implementation
- timelock honored      : no finalization before created_tick + timelock_ticks
- threshold/quorum exact : pass iff for_power/total ≥ tier supermajority AND turnout ≥ tier quorum
```

### 5. LIVE-PROOF (what counts as the PP# demonstration on ton-testnet)
```
create a tier-N proposal → cast votes from ≥quorum slots → reach the supermajority → finalize at timelock
→ observe the on-chain Outcome == the expected decision (and the off-chain kernel honors it).
```

### 6. PARITY (which implementations must agree)
```
- the tally/power/threshold math is a §2.3 governance action ⇒ TS == Rust == Go NORMATIVE golden vectors
  (every impl agrees what the Outcome MUST be for a given vote set), AND
- the on-chain authority (Tolk) computes that same Outcome ⇒ its golden = code-hash + decision vectors that
  reproduce the kernel goldens. Off-chain "given Outcome O, apply amendment" (execution) is kernel-side parity.
```

### 7. RE-FREEZE TRIGGERS (defined up front)
```
- any change to the voting-power model (sqrt, JurisdictionAlignment, ClusterAffinity)
- any change to a tier's supermajority / quorum / timelock
- any change to finalization rules or the Capture-Guard / cluster-detection parameters
- adding a 3A-modifier (each is a re-freeze of the power/threshold surface)
```

## Out of scope for PFC-3A (belongs to 3B / 3C)
`oracle aggregation · slashing · PTRA staking / rewards / emission · treasury spending` — those are PFC-3B
(Oracle Authority) and PFC-3C (PTRA Economics). 3A decides governance outcomes only.

## What this R0 ratifies vs defers
```
RATIFIED here:  the Governance Freeze Surface (the 7 points) · the model = Constitution §VII (quadratic
                NFT-slot, not 1t1v/delegated)
TO RATIFY now:  the PHASING (3A-core / 3A-modifiers-later / 3A-full) — the follow-up question
DEFERRED:       detailed semantics doc + golden vectors + code — only AFTER phasing is ratified
```

## Related
- `pfc3-charter.md` — the umbrella (split/sequence/template) this fills for line 3A.
- `docs/spec/constitution-v0.9.5.md` §VII — the normative governance model PFC-3A implements.
- `tolk/contracts/governance-view.tolk` — the Stage-A read-model PFC-3A promotes to an authority.
- `pfc2-multisig-charter.md` — the PFC freeze discipline (charter → vectors → parity → live proof → freeze).
