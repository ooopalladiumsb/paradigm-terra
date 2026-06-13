# Layer 3 — governance / oracle / PTRA charter (R0)

**Date:** 2026-06-13 · Branch `feat/layer3-charter` · Opens **Layer 3** of the post-v2.0.0 roadmap — the
governance economy, oracle, and PTRA token from `SIMULATION_PREVIEW.md`. Charter-first / R0, mirroring the
Layer-2 + PP#4-R0 discipline: **fix the one decision that defines the whole track BEFORE any code.** This
is the first **Tier-C-candidate** track since PFC-2 — read this before writing a line.

## The transition this track marks

```
v2.x operational contour CLOSED (wallet.* live + Layer-2 read-models deployed + genesis live)
        ↓
"Should governance/oracle/PTRA be ON-CHAIN PROJECTIONS of the frozen off-chain consensus
 (like Layer 2), or should they become AUTHORITATIVE on-chain decision-makers (on-chain voting,
 oracle aggregation, a real token) — i.e. the SIMULATION_PREVIEW economy?"
```

## 1. The central decision (decide BEFORE any code) — Framing A vs B

A pivotal fact frames everything: the off-chain frozen consensus **already decides** governance / oracle /
PTRA. They are registered §2.3 actions with scopes (`dsl/src/taxonomy.ts`): `governance.{propose_amendment,
vote, vote_as_agent, finalize_amendment}`, `oracles.{submit_feed, slash, force_update}`, `ptra.{stake,
unstake, claim_rewards}` — validated + reduced off-chain today. So two coherent framings:

| Framing | What the Layer-3 contracts ARE | Tier / line | Cost / risk |
|---|---|---|---|
| **A. Read-model projections** | On-chain mirrors of the already-decided off-chain governance/oracle/ptra state (proposal/vote tallies, feeds, stakes), written by the trusted publisher. Extends the Layer-2 pattern; the off-chain fold stays authoritative. | **Tier-M, off-consensus**, MINOR, freeze-gate byte-identical | low — consistent with Layer 2; completes the on-chain projection set |
| **B. Authoritative on-chain economy** | The contracts MAKE the decisions: on-chain NFT-slot voting + tallying, on-chain oracle aggregation + slashing, a real PTRA token with on-chain staking/rewards (the SIMULATION_PREVIEW genesis). The consensus boundary moves on-chain. | **Tier-C → new freeze line PFC-3 → MAJOR v3.0.0** | high — re-platforms the decision boundary; the genuine PFC-3 the project reserved |

**This is the same fork as Layer 2's — but Layer 2 was unambiguously A (mirrors). Layer 3 is where B
becomes a real option, because the SIMULATION_PREVIEW vision (on-chain governance economy) IS Framing B.**
Unlike Layer 2, I do **not** pre-recommend; the answer is a product decision the user must make, because
it determines whether this track is a few MINOR releases or a multi-month MAJOR (PFC-3 / v3.0.0).

## 2. Per-subsystem nuance (the framing need not be uniform)

```
PTRA token   : the TOKEN itself can ship Tier-M as a standard jetton (like wallet.send_jetton / v1.1.0).
               on-chain STAKING/REWARDS logic that DECIDES emissions is Framing B.
governance   : projecting tallies = A; on-chain NFT-slot voting + quadratic tally + timelock execution = B
               (this is the SIMULATION_PREVIEW governance — inherently on-chain decisions → B).
oracle       : projecting feeds = A; on-chain feed AGGREGATION + slashing decisions = B.
```

A coherent **staged** path is possible: ship the **A read-models first** (Tier-M, completes the projection
set, fast, freeze-safe), then open **PFC-3 for the B pieces** that genuinely need on-chain decisions —
each B subsystem its own freeze sub-line. This keeps the project's "prove cheap first" rhythm.

## 3. If Framing B — the PFC-3 implications (what it actually costs)

Framing B is **not a Layer-2-style increment**. It is the reserved **PFC-3**, and it inherits the full
freeze discipline (mirrors PFC-2):
```
- a PFC-3 charter + ratified semantics (the new authorization/decision model)
- a NEW Freeze Surface (on-chain voting/aggregation/emission rules become normative)
- NORMATIVE golden vectors for the new rules + a TS == Rust == Go parity cycle (if it touches the kernel)
- a consensus-freeze ruling + a live proof (PP#-style) + MAJOR v3.0.0 (its own branch, re-freeze)
- the "halt-and-surface" rule: any new authorization path is a charter item, not a code decision
```
Estimated XL–XXL (months), per the roadmap. Framing A is M–L (weeks), Tier-M.

## 4. Discipline (anti-scope, until the Framing is ratified)

- **No code until §1 is decided.** This R0 ratifies the framing first (the Layer-2 / PP#4-R0 rule).
- **Framing A work stays Tier-M** (freeze-gate byte-identical, read-models only — the §2.1 Layer-2
  invariant applies: contracts reflect, never decide).
- **Framing B opens PFC-3** with its own charter; it does NOT proceed under this charter.
- **PTRA-token-as-jetton** may proceed Tier-M independently of the governance/oracle framing.

## 5. The decision — RATIFIED: **Staged** (2026-06-13)

```
[ ] A — read-model projections only
[ ] B — authoritative on-chain economy (PFC-3)
[x] Staged — A read-models NOW (Tier-M), then a PFC-3 charter for the B decision pieces
```

**Layer 3 proceeds under Framing A (Tier-M read-models)**, extending the Layer-2 invariant (`layer2-toolchain-charter.md`
§2.1: contracts reflect, never decide). The on-chain governance/oracle/PTRA *economy* (Framing B — on-chain
voting/aggregation/staking-emission) is **explicitly deferred to a future PFC-3 charter** (its own freeze line,
MAJOR v3.0.0); it does NOT proceed here. PTRA-token-as-jetton may ship Tier-M independently if/when wanted.

### Stage-A suite (on the tolk harness, Tier-M, freeze-gate byte-identical)
```
L3.1 governance-view  — projects state.governance (proposal tallies + params); "reflects tallies, never votes"
L3.2 oracle-view      — projects state.oracles.feeds;                          "reflects feeds, never aggregates"
L3.3 ptra-view        — projects state.ptra.balances (+ stakes);              "reflects balances, never mints/stakes"
L3.x genesis          — extend tolk/src/genesis.ts to include the L3 read-models (one suite)
```
Each: owner-gated projection write, byte-identical read-back, non-owner → 401, NO decision op (unknown → 0xffff).
When Stage-A is complete, open the **PFC-3 charter** for Framing B (the decision pieces).

## 6. Related
- `layer2-toolchain-charter.md` — the Framing A read-model pattern + the binding invariant Layer 3-A reuses.
- `SIMULATION_PREVIEW.md` — the on-chain governance economy (the Framing B target).
- `post-freeze-roadmap.md` — Layer 3's place (Tier-C, each subsystem likely its own PFC line).
- `dsl/src/taxonomy.ts` — the off-chain governance/oracle/ptra actions already decided in the frozen consensus.
- `pfc2-multisig-charter.md` — the PFC freeze discipline a Framing-B PFC-3 would mirror.
