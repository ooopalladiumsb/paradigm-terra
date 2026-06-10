# J1 Charter — `wallet.send_jetton` publication path (Tier M)

**Date:** 2026-06-10 · **Status:** charter / pre-registration (no code). Post-release v1.x line, **Tier M**
(publication layer, §8.3 — above/outside the Freeze Surface). Follows the jetton reclassification
(`pfc2-jetton-reclassification.md`). Ships as **v1.1.0** (MINOR). Ratify before the first J1 PR.

## 0. Why J1 (not PFC-2)

The consensus surface already finalizes `wallet.send_jetton` (reclassification §2): registry + scope
(`jetton_access`) + generic validator/reducer/gas are frozen and tested. The **only** missing piece is the
publication codec — §8.3, explicitly outside the freeze. So jetton is a Tier-M publication feature, the
same nature as M2/M3, and rides `pfc1-consensus-freeze`. **No new freeze line, no consensus-vector
regeneration.**

```
Role:           the publication path for the already-frozen wallet.send_jetton verb
Mode:           offline-first (codec + ir_to_boc); the real testnet transfer (PP#3) is GATED (the PP#2 / M2-C pattern)
Tier:           M  ·  Freeze Surface: immutable (freeze-gate stays byte-identical)
Release:        v1.1.0 (MINOR — a new operational capability)
```

## 1. Scope

### IN
- **J1-A — publication codec.** Extend `orchestrator/src/w5/canonical-to-inner.ts` with a `send_jetton`
  body encoder: add `wallet.send_jetton` to `V0_1_0_ENCODABLE`, emit the TEP-74 `transfer` body
  (`pfc2-1-send-jetton-semantics.md` §5), with the deterministic normalization (§9) and the ⊆ rule on
  both the jetton `amount` and the attached TON value. The outer `action_send_msg` targets the agent's
  jetton wallet (codec-derived, D1).
- **J1-B — `ir_to_boc` for jetton.** Serialize the jetton `InnerRequest` to the W5 cell/BoC (the `pp2/`
  `ir_to_boc` surface, extended for the nested body); round-trip-exact, offline.
- **J1-C — Proof Package #3.** A real ton-testnet jetton transfer: `CAL → codec → ir_to_boc → W5 external
  → sendBoc → tx → on-chain jetton effect`, with the ⊆/effect-fidelity verdict (the PP#2 §3.1 discipline),
  and the settlement recorded via the M2 reconciliation registry. GATED on testnet access.
- **J1-D — release v1.1.0.** Notes + changelog; rides the frozen surface byte-identically.

### OUT
- Any consensus-layer change (none is needed; freeze-gate stays byte-identical).
- `wallet.send_nft` (same machinery, a later J-track), Multisig, mint/burn, `custom_payload` (Non-goals, PFC2-1 §8).
- Promoting any contract to normative.

## 2. Success criteria

```
SC-1  J1-A codec: canonicalToInner(send_jetton CAL) → a faithful TEP-74 OutList body; offline tests
      (faithful amount+dest, no widening on amount OR TON value, normalization defaults, malformed-param reject).
SC-2  J1-B ir_to_boc(jetton IR) round-trips byte-exact (IR == IR'), offline.
SC-3  PP#3 (gated): a real testnet jetton transfer; on-chain effect == the CAL's authorized jetton action;
      settlement recorded in the M2 registry. Verdict A.SUCCESS (PP#2 discipline).
SC-Freeze  freeze-gate byte-identical (consensus untouched); the existing send_jetton finalization is unchanged.
SC-5  the base CAL authorization model is unchanged (it already was — this only adds a codec).
```

PP#3 (SC-3) is gated/operational (needs testnet + a funded jetton balance); J1 closes offline on
SC-1/SC-2/SC-Freeze, with SC-3 strengthening it to live, exactly as M2-C/PP#2 were gated.

## 3. Failure taxonomy
- **Publication-layer defect** (codec/ir_to_boc/envelope bug): fix in J1; freeze intact (the verb already
  finalizes in consensus; this is the §8.3 layer). Expected class for any SC-1/SC-2 miss.
- **PP#3 effect mismatch** (on-chain jetton effect ≠ authorized action): the PP#2 B-vs-C discriminator
  applied to jetton — a faithful codec the chain executes differently would be the only thing escalating
  beyond publication, but jetton semantics are TEP-74-standard, so a publication-layer fix is expected.
A J1 failure cannot move the Freeze Surface — the consensus path is frozen and unchanged.

## 4. Branch policy
Working branch **`post-release/j1-jetton-publication`** (off `main`, like M2/M3). J1-A/J1-B land as
ordinary operational PRs; J1-C (PP#3) attaches when testnet access exists; J1-D tags v1.1.0.

## 5. Related
- `pfc2-jetton-reclassification.md` — why jetton is Tier M (the falsified Tier-C hypothesis).
- `pfc2-1-send-jetton-semantics.md` — the verb semantics J1 implements (codec target + TEP-74 mapping + normalization).
- `proof-package-2-spec.md` / `m2-charter.md` — the PP#2 proof discipline + M2 reconciliation PP#3 reuses.
- `orchestrator/src/w5/canonical-to-inner.ts` / `pp2/src/ir-to-boc.ts` — the codec surfaces J1-A/J1-B extend.
