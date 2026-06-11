# PP#4-B Gate — pre-broadcast checkpoint (Multisig anchor)

**Date:** 2026-06-11 · **Status:** gate / pre-registration. The checkpoint that must hold BEFORE the
irreversible ton-testnet broadcast (PP#4-B). Mirrors `pp3-b-gate.md`: fix reproducibility, the
prerequisites, the expected effect, and the resume plan in advance, so the broadcast is a confirmation,
not a discovery. **Nothing here touches the network** — the live step is §3, gated on §2.

## 0. What PP#4-B confirms

PP#4 (Framing B, `pp4-multisig-proof.md`) is proven OFFLINE: a quorum-authorized `treasury.transfer`
finalizes and commits its effect through the real validator→reducer path; the sub-threshold twin is
rejected `QUORUM_NOT_MET`. PP#4-B anchors the **quorum-finalized consensus STATE_ROOT** on ton-testnet —
the on-chain artifact that ties the multisig authorization to an immutable public commitment.

```
anchor payload (offline-proven, DETERMINISTIC):  STATE_ROOT = 0x4a14f8f11f37657e62aa6670822a18544fe1fea560aac17f16cd9234efc4d4f0
```

## 1. Reproducibility evidence (pinned)

```
multisig surface   pfc2/consensus @ c67bfd5 (M2..M7 + re-freeze + R0/R1), all 6 CI checks green
golden vectors     validator/vectors/golden.json — NORMATIVE, TS==Rust==Go on all 30 (incl. 7 multisig)
offline proof      orchestrator/scripts/pp4-plan.ts → pp2/artifacts/pp4/pp4-plan.json
                   quorum-pass 2-of-3 → FINALIZED, effect commits, anchor root 0x4a14…d4f0
                   sub-threshold 1-of-3 → QUORUM_NOT_MET, no effect
determinism        fixed Ed25519 PKCS8 seeds (owners 01/02/03, operator 0f) → byte-stable anchor root
                   (re-run orchestrator/test/pp4-multisig-anchor.test.ts to reconfirm before broadcast)
```

## 2. Operational prerequisites — REQUIRED before §3 (operator-supplied; NOT done here)

These are the items the offline work cannot produce. **PP#4-B does NOT open until every box is checked:**

```
[ ] funded ton-testnet operator wallet (the anchoring sender)
      · address: ____________________   · state: active   · balance ≥ ~0.1 TON (one external message + fees)
      · funded from the testnet faucet; read-only balance confirmed
[ ] key custody confirmed for the operator wallet
      · who holds the operator signing key, where, and the sign+broadcast procedure
      · the OWNER quorum keys are the proof's deterministic seeds (offline) — only the anchoring
        OPERATOR key needs live custody (it sends the single anchor message; it does NOT change the
        proven authorization, which is fixed in the offline payload)
[x] anchor transport decided — PINNED (2026-06-12, §2.1 below). Dedicated typed anchor cell, operator-independent.
[x] re-confirmation: orchestrator/test/pp4-multisig-anchor.test.ts green (3/3) → anchor root still 0x4a14…d4f0
```

Two boxes remain (`funded operator wallet`, `key custody`) — operator-supplied, the only items left before §3.
Everything the offline work can produce is done: the anchor root is re-confirmed and the on-chain body is pinned.

### 2.1 Anchor transport — PINNED (box 3)

The 32-byte STATE_ROOT is carried as a **dedicated typed anchor cell**, fixed offline and independent of the
operator wallet (the outer W5 wrapping + the operator signature are applied at broadcast time, §3 step 2/4):

```
anchor body cell = op:uint32 (= ANCHOR_OP) || state_root:bits256 (raw 32 bytes)   [288 bits, single cell]
  ANCHOR_OP        = 0x50544131  (ASCII "PTA1" — Paradigm Terra Anchor v1; disjoint from op 0 / TEP-74)
  on-chain effect  = self-transfer (operator → operator, bounce=false) whose message body == this cell

For STATE_ROOT 0x4a14f8f11f37657e62aa6670822a18544fe1fea560aac17f16cd9234efc4d4f0:
  body cell hash   = 0x79543a1b015462d0920125b5e41eb5c57f38b2f7d7a243fb689f13e5a103d0bc
  body BoC (b64)   = te6cckEBAQEAJgAASFBUQTFKFPjxHzdlfmKqZnCCKhhUT+H+pWCqwX8WzZI078TU8AQJrCo=
```

Codec: `pp2/src/anchor-body.ts` (`anchorBodyCell` / `parseAnchorRoot` / `anchorBodyBoc`). Determinism +
round-trip + op-guard + malformed-root rejection pinned in `pp2/test/pp4-anchor-body.test.ts` (5/5, suite 23/23).
The hash + BoC above are the byte-exact off-ramp values for §3 step 3, and the reconstruction target for step 5.

## 3. PP#4-B runbook (the single live step — GATED on §2)

```
Step  Action                                                    Irreversible?
1     read-only: confirm operator wallet active + funded        no
2     wrap the §2.1 PINNED anchor body (BoC above) in a W5       no (offline construction)
      external message from the operator wallet (self-transfer,
      bounce=false); sign with the custodied operator key
3     PRE-BROADCAST GATE: assert the message body hash ==        no (the last off-ramp)
      0x79543a…d0bc (§2.1) AND re-run the offline proof (root
      still 0x4a14…d4f0). Abort on any drift.
4     BROADCAST the anchor message to ton-testnet               YES — the single proof tx
5     observe: fetch the tx; reconstruct via parseAnchorRoot     no (read)
      → assert body == STATE_ROOT 0x4a14…d4f0 ("inspect first")
6     record evidence → pp2/artifacts/pp4/pp4b-evidence.json     no (idempotent write)
```

The sub-threshold twin is NOT broadcast — by construction it never produced a state change (nothing to
anchor); its rejection is the offline-proven `QUORUM_NOT_MET` (re-runnable, no tx).

## 4. Roll-forward / resume plan (idempotency)

| Step | Irreversible? | Resume rule (idempotent guard) |
|---|---|---|
| 1 funding check | no | re-runnable (read-only) |
| 2 build message | no | deterministic; rebuild from the pinned payload |
| 3 pre-broadcast gate | no | the last off-ramp — abort here if the root drifts |
| 4 broadcast | YES | guard: run once; if an anchor tx for this root already exists, treat as done |
| 5 observe | no | re-runnable; the OBSERVED on-chain payload decides, not the broadcast call |
| 6 evidence | no | idempotent upsert keyed by the anchor tx hash |

Only step 4 is irreversible, and it carries the offline-proven payload — so an interrupted run resumes by
inspecting the chain (PP#2 §3.1 "inspect before classifying"): if the anchor is already on-chain with the
correct root, PP#4-B is SETTLED.

## 5. Evidence package structure (`pp2/artifacts/pp4/pp4b-evidence.json`)

```json
{
  "result": "PP#4-B SETTLED",
  "network": "ton-testnet",
  "framing": "B — quorum-authorized treasury.transfer STATE_ROOT anchor",
  "operator": "<anchoring wallet address>",
  "authorization_set": { "owners": ["…","…","…"], "threshold": "2" },
  "anchor": {
    "state_root": "0x4a14f8f11f37657e62aa6670822a18544fe1fea560aac17f16cd9234efc4d4f0",
    "transport": "<exact on-chain body encoding>",
    "external_message_hash": "<hash>",
    "tx_hash": "<hash>"
  },
  "offline_correlation": {
    "pp4_plan": "pp2/artifacts/pp4/pp4-plan.json",
    "anchored_root_equals_offline_root": true
  },
  "sub_threshold": { "broadcast": false, "reason": "QUORUM_NOT_MET — no state change to anchor" },
  "verdict": "SETTLED"
}
```

## 6. Success criteria — PP#4-B PASSES iff

```
SC-1  the anchor tx lands on ton-testnet (confirmed)
SC-2  the on-chain anchored payload == the offline quorum-finalized STATE_ROOT (0x4a14…d4f0), byte-identical
SC-3  the offline proof still reproduces that root (determinism intact)
SC-4  the sub-threshold twin was NOT broadcast (QUORUM_NOT_MET produced nothing to anchor)
SC-5  no Freeze Surface defect surfaced (the surface is publication-independent; an anchor is read-only of consensus)
```

On all five, PP#4 is SETTLED → the M1 §6 authorization envelope is demonstrated end-to-end (offline proof
+ on-chain anchor) → proceed to the `pfc2-consensus-freeze` ruling (`pfc2-consensus-freeze-draft.md`).

## 7. Related
- `pp4-multisig-proof.md` — the PP#4 readiness review + Framing B ruling (R0) and offline proof (R1).
- `pp3-b-gate.md` — the PP#3 pre-broadcast gate this mirrors.
- `pfc2-consensus-freeze-draft.md` — the freeze ruling PP#4-B unblocks.
- `pp2/artifacts/pp4/pp4-plan.json` — the deterministic anchor payload.
