# Post-Freeze roadmap & branch discipline

**Date:** 2026-06-06 · Follows the PFC-1 Consensus Freeze ruling (`pfc1-status-review.md §0`,
tag `pfc1-consensus-freeze` @ `54e1864`, frozen state `2fd4b8a`).

## The risk has qualitatively changed

```
Before OVT / Freeze:   "Is the model correct?"            ← answered (no Freeze Surface defect in OVT)
After Freeze:          "Does real TON match the model's   ← the new dominant question
                        assumptions?"
```

This is a different *kind* of risk. The freeze retired the internal-correctness question; what remains
lives at the boundary with the live network. The single most information-bearing future experiment is
**Proof Package #2** — the first time the frozen model meets the real TON network and shows whether a
hidden gap between CAL and actual W5 semantics still exists.

## Branch discipline (effective at freeze)

The frozen line `pfc1-consensus-freeze` (@ `54e1864`) is the reference object for "what was frozen."
On the branch `feat/tc-v2-sig-verify-v1`, from here on, **only**:

- documentation fixes;
- freeze-artifact clarifications;
- **discovery of a Freeze Surface defect** (which re-opens the freeze rather than being patched silently).

**Any** change to the model / consensus / economics / validator / canonicalization is, by definition,
a **new line of work** — not a PFC-1 edit. It starts its own branch and (if it changes consensus)
its own freeze line (`pfc2-consensus-freeze`, …).

## Roadmap

```
PFC-1 Consensus Freeze         ✅  (2026-06-06, tag pfc1-consensus-freeze @ 54e1864)

PP#2 — Testnet Validation      ⬜  ← NEXT major milestone (highest information value)
  - ir_to_boc (BoC serialization of the Annex F InnerRequest)
  - W5 external message (sendTransaction)
  - Registry contract deployment
  - tx_hash capture (the on-chain falsification)

Live Observer (H3.5)           ⬜
  - independent reproduction of a running node's roots
  - published artifacts

Production Readiness:
  - Daemon                     ⬜  (mempool, scheduler, polling, monitoring)
  - Checkpointing (OVT-SG)     ⬜  (snapshot strategy, replay-tail; cold re-fold is linear-but-heavy)
  - Monitoring                 ⬜

Launch Readiness               ⬜
```

The next major milestone is **not** "prove the core" (done) but **Proof Package #2** — it is the
experiment that can still surface a CAL ↔ W5 gap, and is therefore the highest-value next step. Its
offline groundwork is already laid: the CAL→W5 mapping is reviewed (`cal-to-w5-mapping-review.md`) and
the Annex F OutList arm is implemented (`orchestrator/src/w5/canonical-to-inner.ts`); what remains —
`ir_to_boc`, the external message, Registry deployment, on-chain capture — is network-gated.

## Related
- `pfc1-status-review.md` — the freeze ruling + promotion criteria.
- `freeze-manifest-pfc1.md` — what is frozen (the normative inventory).
- `cal-to-w5-mapping-review.md` — the CAL→W5 model review (PP#2 groundwork).
- `reproducibility-guide.md` — clean-room reproduction (deterministic-root vs property targets).
- `operational-validation-track.md` — OVT charter (the live legs H3.1/H3.5 remain its bar).
