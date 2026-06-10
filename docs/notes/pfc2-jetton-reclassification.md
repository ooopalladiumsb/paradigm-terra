# PFC-2 jetton reclassification — Tier C hypothesis FALSIFIED, jetton is Tier M

**Date:** 2026-06-10 · **Status:** finding / governance correction. Supersedes the Tier-C framing of
`pfc2-charter.md` (PFC2-0) and `pfc2-1-send-jetton-semantics.md` (PFC2-1) **for jetton**. History is kept
(not deleted) — this is the audit trail of a hypothesis tested against the code and falsified.

## 0. The hypothesis (PFC2-0)

The v1.x roadmap classified new verb classes (jetton/nft) as **Tier C**: *"New verbs change validator /
reducer / gas semantics ⇒ Freeze Surface ⇒ a new freeze line → v2.0.0."* PFC2-0/PFC2-1 opened PFC-2 on
that basis, with `wallet.send_jetton` as the first verb.

## 1. The investigation (grounding in the frozen code)

Before writing PFC2-2 (validator), the actual consensus surface was inspected:

| Layer | Finding | Evidence |
|---|---|---|
| **Action registry (§2.3)** | `wallet.send_jetton` is **already registered** | `dsl/src/taxonomy.ts`: `ACTION_TAXONOMY.wallet = ["send_ton", "send_jetton", "send_nft"]` |
| **Scope (Annex A)** | scope **already frozen** as `jetton_access` (NOT a new scope) | `dsl/src/taxonomy.ts`: `REQUIRES_SCOPE_TABLE["wallet.send_jetton"] = ["jetton_access"]` |
| **Validator** | **no** per-verb logic — only registry + scope + DSL guards + trace | `validator/src/validate.ts` (`capabilityGrants` / `isRegisteredAction`; params used only for post-conditions) |
| **Gas** | **no** per-verb weight for send verbs (generic) | `cal-gas/src/*` — grep for `send_*` / `wallet.` = empty |
| **Reducer** | **no** per-verb effect logic (generic) | `cal-reducer/src/*` — grep for `send_*` / `wallet.` = empty |
| **Publication codec** | the **only** verb-specific gap: encodes `send_ton` body only | `orchestrator/src/w5/canonical-to-inner.ts`: `V0_1_0_ENCODABLE = {wallet.send_ton}`; jetton ⇒ `W5_UNIMPLEMENTED_VERB` |

## 2. The decisive test (empirical, reproducible)

A `send_jetton` CAL was run through the **frozen** validator:

```
agent granted ["jetton_access"]  → validate(send_jetton CAL) → terminalStage = FINALIZED
    events: cal.validated → cal.executed → cal.settled → cal.finalized
agent granted ["ton_transfer"]   → validate(send_jetton CAL) → FAILED / CAPABILITY_DENIED
```

`wallet.send_jetton` **already finalizes through the frozen consensus pipeline today.** The verbs were
pre-registered with generic handling from the start; nothing in validator/reducer/gas/canonicalization is
verb-specific for them.

## 3. The finding

**The Tier-C hypothesis is FALSIFIED for jetton.** Implementing `send_jetton` requires **no** change to
any frozen consensus layer — registry, scope, validator, reducer, gas, and canonicalization already
handle it and produce its consensus outputs. The only missing piece is the **publication codec**
(`canonical_to_inner` jetton body + `ir_to_boc`), which CAL Exec Spec §8.3 explicitly scopes **OUT** of
the Freeze Surface. Therefore:

```
jetton is a PUBLICATION-LAYER feature  →  Tier M  →  rides pfc1-consensus-freeze  →  MINOR (v1.1.0)
```

No new freeze line, no regenerated NORMATIVE consensus vectors (consensus behaviour is unchanged — it was
frozen, and tested-finalized, from the start). This is the same nature as M2/M3 (publication/integration).

## 4. Governance consequence

- **PFC2-0 Charter** → **CLOSED (superseded)** — its Tier-C premise does not hold for jetton.
- **PFC2-1 Semantic Design** → **CLOSED (reclassified)** — the semantics are correct and reused, but as a
  publication-layer feature, not a freeze-line change. **Correction:** the scope is the frozen
  `jetton_access` (PFC2-1 D3's proposed `jetton_transfer` was wrong — `jetton_access` already exists).
- **PFC2-2 Validator / PFC2-3 Reducer** → **NOT NEEDED** (no Freeze Surface movement to implement).
- New track **J1 — `wallet.send_jetton` publication path** (`j1-jetton-publication-charter.md`): J1-A codec
  · J1-B `ir_to_boc` · J1-C PP#3 (real testnet jetton transfer) · J1-D release **v1.1.0**.

## 5. What a REAL PFC-2 now requires (the bar is raised)

After this finding, PFC-2 (a genuine new freeze line) must start with a change that demonstrably moves at
least one frozen layer: validator / reducer / **authorization model** / gas economics / consensus vectors.
The strongest candidate is **Multisig v2.1** (`owners[]` / `threshold`) — it changes the single-owner
authorization model itself, which is unambiguously Freeze Surface. PFC-2 is **reserved** for that (or an
equivalent consensus-moving change), after the J1 jetton track ships v1.1.0.

## 6. Related
- `pfc2-charter.md` (PFC2-0) · `pfc2-1-send-jetton-semantics.md` (PFC2-1) — superseded by this doc.
- `j1-jetton-publication-charter.md` — the Tier-M track that actually ships jetton.
- `cal-to-w5-mapping-review.md` §6.5 / §8.3 — nested transfer bodies + the publication-layer boundary.
- `dsl/src/taxonomy.ts` — the frozen §2.3 registry + Annex A scope table (the evidence in §1).
