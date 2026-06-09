# @paradigm-terra/pp2 — Proof Package #2 publication layer (DRAFT)

**Post-freeze, NOT consensus-binding.** This package lives on the integration line
(`post-freeze/pp2`), above the PFC-1 Consensus Freeze (tag `pfc1-consensus-freeze` @ `54e1864`). It
does **not** touch any frozen package. DRAFT until the on-chain leg (H3.1 / PP#2-B) validates it.

## PP#2-A — `ir_to_boc` + offline round-trip (done)

`src/ir-to-boc.ts` serializes the Annex F `InnerRequest` IR (the OutList arm from
`orchestrator/src/w5/canonical-to-inner.ts`) into a Wallet-V5 signed-body cell + BoC, and parses it
back:

```
IR  --irToBoc-->  BoC (te6…)  --bocToIr-->  IR'      assert IR == IR'
```

This is the first post-freeze experiment, kept deliberately isolated to the **new** layer
(`canonical_to_inner → ir_to_boc → W5 cells`) — no wallet, no deploy, no network — so any failure is
unambiguously a *publication-layer* defect, not a Freeze Surface defect (see
`docs/notes/proof-package-2-spec.md` §4: there is no offline *chain-acceptance* oracle, so we validate
internal invariants — round-trip identity, BoC well-formedness, and the `TON-valid ⊆ CAL-valid` rule
at the cell layer: faithful value/dest, no carry-mode bits, ≤255 actions, empty ExtendedActions arm).

Cell/BoC primitives + `MessageRelaxed` come from **`@ton/core`** (the reference TON library — we do
not reimplement TL-B); the W5 body layout and the IR↔cell mapping are ours and are exactly what the
round-trip exercises.

```bash
cd pp2 && npm install && npm test     # 10/10 round-trip + invariant tests
```

**Result (2026-06-06):** round-trip is exact across bare transfer / multi-action / text-comment /
empty OutList; ⊆ invariants hold at the cell boundary. **No publication-layer defect found offline.**

## Next — PP#2-B (network-gated)

The full §6.1 external (envelope `wallet_id`/`valid_until`/`seqno`/`signature` + this inner body),
`sendBoc`/TON Connect, a testnet `tx_hash ≠ null`, and the on-chain effect check. Requires testnet
access; see `proof-package-2-spec.md` and `post-freeze-roadmap.md`.
