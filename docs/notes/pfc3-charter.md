# PFC-3 — on-chain decision economy charter (R0 / umbrella)

**Date:** 2026-06-13 · Branch `feat/pfc3-charter` · Opens **PFC-3**, the reserved Tier-C freeze line for
the on-chain governance / oracle / PTRA **economy** (the Framing-B deferred by `layer3-charter.md`).
Charter-first / R0, mirroring PFC-2 + Layer-2/3 discipline: **define the NEW Freeze Surface BEFORE any
code.** This is the first qualitative inversion of the v2.x axiom — read it before writing a contract.

## 1. The qualitative shift this freeze line marks

```
v2.x axiom (PFC-1/2 + Layers 2/3-A):   truth = off-chain fold;  on-chain = projection/anchor (REFLECTS)
PFC-3:                                  specific decisions become on-chain SOURCES OF TRUTH (DECIDES)
```

Everything through v2.3.0 obeyed "reflect, never decide" (Stage-A invariant). PFC-3 introduces the **first
on-chain source of truth the off-chain consensus must honor** — a vote tally, a feed aggregation, a token
balance/stake. That inversion is exactly why it cannot ride the 2.x line: it changes *where consensus is
decided*, so it is a **new freeze line → MAJOR v3.0.0**, with full PFC discipline (mirrors PFC-2).

**The charter's job:** answer, per line, *what becomes a source of truth that was not in v2.x* — and pin
that as the new Freeze Surface before it can be accidentally widened by code.

## 2. The three lines — SEQUENCED, not parallel (RATIFY this order)

Governance governs Oracle and Economics; the reverse dependency would add cycles. So:

```
PFC-3A Governance Authority   →   PFC-3B Oracle Authority   →   PFC-3C PTRA Economics
```

Each line is its own freeze sub-line with its own charter + Framing ratification (this R0 ratifies the
split, the order, the "start at Framing A" rule, and the freeze-surface template below).

### PFC-3A — Governance Authority  (`Governance View → Governance Authority`)
```
Framing A (START): on-chain voting + tally  ·  off-chain execution (the kernel reads the on-chain tally
                   result and applies the amendment off-chain)
Framing B:         on-chain voting + tally + ON-CHAIN execution (timelock + on-chain effect)
```
New source of truth: **the vote tally/outcome** (was: an off-chain-decided ProposalRecord merely mirrored).

### PFC-3B — Oracle Authority  (`Oracle View → Oracle Aggregation`)
```
Framing A (START): signed feed registry (feeds posted + signed on-chain; consumers read; no on-chain agg)
Framing B:         on-chain aggregation + quorum + slashing
```
New source of truth: **the accepted feed set** (was: a single off-chain-settled value mirrored).

### PFC-3C — PTRA Economics  (`PTRA View → Economic Layer`)
```
Framing A (START): plain PTRA jetton (a standard token — balances authoritative on-chain; Tier-M-adjacent)
Framing B:         on-chain staking / rewards / emission
```
New source of truth: **PTRA balances** (was: off-chain balances mirrored).

## 3. NEW FREEZE SURFACE — the per-line template (the core of this charter)

Each PFC-3 sub-line's charter MUST specify, and its consensus-freeze ruling MUST cover, all seven:

```
1. STATE        — what new authoritative state exists on-chain (and how the off-chain kernel reads it)
2. EVENTS       — the on-chain events that mutate it (op-codes, message schemas)
3. TRANSITIONS  — the exact rules that DECIDE (tally math, aggregation rule, emission formula) — normative
4. INVARIANTS   — what must always hold (e.g. no double-vote, monotonic tally, supply conservation)
5. LIVE-PROOF   — the PP#-style on-chain demonstration that the decision settles correctly on ton-testnet
6. PARITY       — if a transition is computed in the off-chain kernel too, TS == Rust == Go golden vectors;
                  if it lives only on-chain (Tolk), the golden is the contract code-hash + decision vectors
7. RE-FREEZE    — the conditions to promote the sub-line to consensus-freeze (gates all ✅, cooling-off)
```

The boundary question each sub-line answers explicitly: **which transitions move on-chain (new Freeze
Surface) and which stay in the frozen off-chain kernel (untouched).** Anything that stays a projection is
NOT PFC-3 — it already shipped in Stage-A.

## 4. PFC discipline (mirrors PFC-2)

```
sub-line charter → ratified semantics → NORMATIVE golden vectors → TS/Rust/Go parity (for kernel-side rules)
→ re-freeze (freeze-gate green) → live proof (PP#) → consensus-freeze ruling → MAJOR v3.0.0 merge
```
- **No code until each sub-line's Framing is ratified** (the Layer-2/PP#4-R0 rule).
- **halt-and-surface:** any new authorization/decision path is a charter item, not a code decision.
- v3.0.0 is the first release on the `pfc3-consensus-freeze` line; PFC-1/PFC-2 (v1.x/v2.x) stand beneath it.

## 5. What this R0 ratifies vs defers

```
RATIFIED here:  the split (3A/3B/3C) · the order (3A → 3B → 3C) · start each at Framing A ·
                the 7-point NEW-FREEZE-SURFACE template every sub-line must fill
DEFERRED:       each sub-line's detailed semantics + its own Framing-A/B ratification + code — in its OWN
                charter (pfc3a-charter.md first). No governance/oracle/economics contract is written here.
```

Next step after this R0: open **`pfc3a-charter.md`** (Governance Authority, Framing A — on-chain voting +
tally, off-chain execution), fill the 7-point freeze surface, ratify, THEN build.

## 6. Related
- `layer3-charter.md` — the Staged ruling that deferred Framing B to here; Stage-A read-models PFC-3 builds on.
- `pfc2-multisig-charter.md` / `pfc2-consensus-freeze-draft.md` — the PFC freeze discipline this mirrors.
- `post-freeze-roadmap.md` — PFC-3's place (the next major track → v3.0.0).
- `SIMULATION_PREVIEW.md` — the governance economy (NFT slots, quadratic voting, oracle, PTRA) PFC-3 realizes.
- `dsl/src/taxonomy.ts` — the off-chain governance/oracle/ptra actions whose *decisions* PFC-3 moves on-chain.
