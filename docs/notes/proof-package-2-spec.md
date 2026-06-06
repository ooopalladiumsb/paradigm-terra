# Proof Package #2 — pre-registration (spec + success criteria, set BEFORE the run)

**Date:** 2026-06-06 · Post-freeze (PFC-1 Consensus Freeze, tag `pfc1-consensus-freeze` @ `54e1864`).
**Status:** requirements-level pre-registration. No testnet run yet; this fixes *what PP#2 must
contain* and *what counts as success/failure* **in advance**, so the verdict can't be rationalized
post-hoc. (Same discipline as the OVT hypotheses: a falsifiable claim stated before the experiment.)

## Why pre-register

PP#2 is the **first contact of the frozen model with the real TON network** — the last place a hidden
gap between the CAL model and actual W5 semantics could surface (Proof Package #1 already exposed one
such gotcha: signing `cal_hash` string vs `canonical_bytes`). To keep PP#2 a genuine falsification
test rather than a demo, its success criteria and its failure taxonomy are pinned here, before access.

## 1. Minimal composition of Proof Package #2

The pipeline, each stage an artifact field (extends PP#1's `docs/proofs/proof-package-1.json`, which
ended at `transport.tx_hash: null`):

```
CAL (signed)                          ← same shape as PP#1
  → canonical_to_inner(cal)           ← InnerRequest IR        (DONE offline: orchestrator/src/w5/)
  → ir_to_boc(inner)                  ← W5 cell/BoC bytes       (offline-buildable, NO offline oracle)
  → W5 external message               ← envelope{wallet_id, valid_until, seqno, signature} + inner
  → sendTransaction (TON Connect)     ← NETWORK
  → testnet tx_hash                   ← NETWORK
  → on-chain result                   ← NETWORK (the message's action-phase effect)
  → replay proof                      ← the CAL's off-chain finalized state vs the on-chain effect
```

Required fields in the PP#2 artifact:

| Field | Source | Offline? |
|---|---|---|
| `cal` + `signatures` + `cal_hash` | as PP#1 | ✅ |
| `inner_request` (the IR) | `canonicalToInner(cal)` | ✅ done |
| `boc` (external message bytes) + `external_message_hash` | `ir_to_boc` + envelope | build offline, **validate on-chain** |
| `valid_until` + `unix_ts_at_tick` mapping used | publication-layer rule (§ below) | ✅ derivable |
| `tx_hash` | testnet broadcast | ⬜ network |
| `on_chain_result` (action-phase outcome, dest, value) | testnet explorer / API | ⬜ network |
| `replay_proof` (off-chain `cal.finalized` ↔ on-chain effect agreement) | both | ⬜ network |

## 2. Success criteria (PP#2 PASSES iff ALL hold)

Pinned in advance:

1. **`tx_hash != null`** — the external was accepted and broadcast by a real wallet/network.
2. **Encoding fidelity:** the external message the wallet actually broadcast equals
   `ir_to_boc(canonicalToInner(cal))` wrapped in the envelope — i.e. **what landed on-chain is what
   our codec predicted** (the integration-correctness check; this is where a CAL↔W5 gap shows).
3. **Effect fidelity (the ⊆ rule, in reality):** the on-chain action-phase effect matches the CAL's
   authorized action — faithful dest + value, no widening (publication shortened-or-equal, never
   extended authorization).
4. **`valid_until` consistency:** the wall-clock `valid_until` the chain checked is consistent with
   the publication-layer rule **TON-valid ⊆ CAL-valid** (never accepts past the CAL's logical
   expiry, never extends it).
5. **No Freeze Surface contradiction:** reproducing the on-chain reality required **no** change to
   CAL / validator / reducer / canonicalization / economics.

## 3. Failure taxonomy (decided in advance)

Not every PP#2 failure means the freeze was wrong. Classify before reacting:

- **Publication-layer failure** (codec/envelope/`valid_until` mapping bug): fix in the PP#2 / W5 code,
  **freeze stays intact**. Expected class for criteria 2–4 misses.
- **Freeze Surface contradiction** (criterion 5 fails): the on-chain semantics demand a change to the
  frozen core → **the freeze re-opens** (OVT criterion 7 is permanent). This is the only outcome that
  invalidates the Consensus Freeze. Expected only if a deep CAL↔TON model mismatch exists.

Stating this split now prevents a publication-layer bug from being mistaken for a freeze defect (and
vice-versa).

## 3.1 Verdict — the pre-registered decision rule (apply IN ORDER, before reacting)

The run yields exactly one of three verdicts. Pinned now so the outcome is *classified*, not
rationalized.

**A. SUCCESS** — iff the FULL chain holds (not merely `tx_hash != null`):
```
sendBoc → tx_hash != null → transaction finalized on-chain → on_chain_effect == expected_effect
```
i.e. all of §2.1–§2.5. A `tx_hash` with a wrong/absent effect is **not** success.

**B. PUBLICATION-LAYER FAILURE** (freeze stays intact; fix PP#2/W5 code; re-run) — the failure is
localized to something WE assemble, with the frozen core untouched (criterion 5 holds). Canonical
cases: bad `seqno` (the §3-finding offset), bad `valid_until`, bad signature, malformed envelope
encoding, a mis-encoded inner body. **Discriminator:** the chain did something other than expected
**AND our encoding ≠ the CAL's intent** (we mis-built the message) → publication-layer.

**C. FREEZE RE-OPEN TRIGGER** (status flips to **Consensus Freeze Reopened** — automatic, NOT
"another PP#2 bug"; criterion 7 is permanent). Any ONE of:
1. CAL reached `cal.finalized` off-chain, but the chain executes a **different effect** than the CAL's
   authorized action — **and our encoding == the CAL's intent** (we built it faithfully; the chain
   still diverged → the model assumed TON semantics that do not hold).
2. The on-chain effect **exceeds** CAL authorization (value/dest/scope beyond what the CAL authorized)
   — authorization *widening* on-chain (`⊆` violated in the extending direction).
3. **`TON-valid ⊄ CAL-valid`**: the chain **accepts** an external corresponding to a CAL the validator
   would **reject or expire** (the forbidden direction of §ⓘ).
4. Reproducing the on-chain reality requires changing CAL / validator / reducer / canonicalization /
   economics (criterion 5 fails).

**The discriminator that separates B from C** is the single most important pre-registration: *did we
encode the CAL faithfully?* A faithful encoding the chain executes differently ⇒ **C (model gap)**. An
unfaithful encoding ⇒ **B (our bug)**. PP#2 therefore always records, alongside `tx_hash`, the
encoding-fidelity check (§2.2) so B-vs-C is decidable from the artifact, not from argument.

**On a C verdict:** record it in the PP#2 artifact, flip `pfc1-status-review.md §0` and
`freeze-manifest-pfc1.md §0` to *Reopened*, and treat it as OVT criterion-7 falsification — the freeze
is revisited, not patched. (This is OVT succeeding, per the charter, not failing.)

## 4. What is offline-buildable now vs network-gated

- **Offline now:** `ir_to_boc` (BoC serialization of the InnerRequest per the W5/V5 TL-B layout) +
  the envelope assembly + the `unix_ts_at_tick` mapping under the §ⓘ one-directional rule. These have
  **no offline oracle** (a captured wallet BoC is a deploy external, not a `canonical_to_inner`
  output), so offline tests cover *internal* invariants (well-formed cells, round-trip, ⊆-faithful
  values), not chain acceptance.
- **Network-gated:** `sendTransaction`, `tx_hash`, on-chain result, replay proof, and criteria 1–3's
  real validation. These wait for testnet access.

### PP#2-A — DONE (2026-06-06, offline)

`ir_to_boc` + round-trip validation landed in `pp2/` (branch `post-freeze/pp2`, package
`@paradigm-terra/pp2`, DRAFT, depends on `@ton/core` for cell/BoC primitives only). The new layer
`canonical_to_inner → ir_to_boc → W5 cells → decode` round-trips **exactly** (`IR == IR'`) across bare
transfer / multi-action / text-comment / empty OutList, with the `⊆` rule enforced at the cell layer
(faithful value/dest, no carry-mode bits, ≤255 actions, empty ExtendedActions). 10/10, typecheck
clean. **No publication-layer defect found offline.** Run: `cd pp2 && npm install && npm test`.
### PP#2-A.5 — Envelope Review — DONE (2026-06-06, no publication)

Design review of `InnerRequest → SignedRequest → ExternalMessage`: `pp2-envelope-review.md`. Decision:
the envelope (opcode/`wallet_id`/`valid_until`/`seqno`/signature layout) comes from the reference
`@ton/ton` `WalletContractV5R1` builder (not hand-transcribed); we supply the field *values* + the
inner body. One seam found and resolved offline — the **nonce↔seqno origin offset** (CAL nonce is
1-based, W5 seqno 0-based; rule: use the wallet's *live* seqno, `cal.nonce == seqno + 1`;
publication-layer, freeze intact). `valid_until` set as a tight window so `TON-valid ⊆ CAL-valid`
holds by construction. No further design-level contradiction → cleared for PP#2-B.

Remaining for PP#2 is **PP#2-B** (network): assemble the external via the W5R1 builder + `sendBoc` +
a real `tx_hash`, then **PP#2-C** effect-fidelity (on-chain effect == CAL action).

## 5. Branch policy

Create the working branch (`post-freeze/pp2`) **only when real testnet access exists** — not before.
An empty integration branch living for months without the ability to validate it is worse than this
pre-registration note on the frozen line. Until then:

- this document is the pre-registration;
- `ir_to_boc` *may* be implemented offline (against §4's internal invariants) on `post-freeze/pp2`
  once that branch is opened, but it cannot close PP#2 without the network.

## 6. Related
- `post-freeze-roadmap.md` — phase transition + branch discipline (PP#2 is Tier 1).
- `cal-to-w5-mapping-review.md` — the CAL→W5 model review; the §ⓘ publication-layer `valid_until` rule.
- `docs/proofs/proof-package-1.json` — the PP#1 artifact PP#2 extends (the on-chain leg PP#1 stubbed).
- `pfc1-status-review.md §0` — the freeze ruling (H3.1 is post-freeze Integration Reality Risk).
