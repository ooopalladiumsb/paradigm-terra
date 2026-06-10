# PFC2-1 — Semantic Design: `wallet.send_jetton` (TEP-74)

> **⚠ RECLASSIFIED (2026-06-10) — these semantics are CORRECT and REUSED, but jetton ships as a Tier-M
> publication feature, not PFC-2.** The consensus surface already finalizes `send_jetton`
> (`pfc2-jetton-reclassification.md`). Implemented by the **J1** track (`j1-jetton-publication-charter.md`,
> v1.1.0). **Correction:** the scope is the frozen `jetton_access` (§2/D3's proposed `jetton_transfer` was
> wrong). All other decisions (D1/D2/D4 + the TEP-74 mapping + normalization) stand and feed J1-A.

**Date:** 2026-06-10 · **Status:** semantic design (NO code). PFC-2 line, on `pfc2/consensus`. Defines the
verb's meaning **before** any Freeze-Surface change. Ratifying this doc (merge) fixes the decisions the
later stages (validator → reducer → vectors → references → PP#3 → freeze) implement. Follows
`pfc2-charter.md` (PFC2-0). Out of scope: nft, multisig (charter §3).

## 0. What `send_jetton` is (and how it differs from `send_ton`)

`wallet.send_ton` is a bare value transfer: one W5 `action_send_msg` to the recipient, `valueNano` =
the authorized TON. `wallet.send_jetton` is a **standard-contract interaction**: the agent's main wallet
sends an internal message **to the agent's own jetton wallet** carrying a **TEP-74 `transfer` body**; that
jetton wallet then moves jettons to the recipient's jetton wallet. So:

```
send_ton:    agent_wallet --(value)--------------------------------> recipient
send_jetton: agent_wallet --(value, TEP-74 transfer body)--> agent_jetton_wallet --(jettons)--> recipient_jetton_wallet
```

Two distinct quantities exist and both are authorization-bearing: the **jetton `amount`** (units moved)
and the **attached TON `value`** (gas to drive the transfer + `forward_ton_amount`). The ⊆ rule (§4)
applies to **both**.

## 1. CAL semantics — canonical form

```
verb: wallet.send_jetton
params:
  jetton_master         : address   # the jetton's master contract (identity/provenance)
  recipient             : address   # the jetton receiver (a normal wallet; its jetton wallet is the on-chain target)
  amount                : integer   # jetton smallest-units, > 0
  response_destination  : address   # where excess TON + the response is returned
  forward_ton_amount    : integer   # TON (nano) forwarded to the recipient with a notification, ≥ 0
  query_id              : integer   # uint64, the TEP-74 query id
  forward_payload       : cell?     # OPTIONAL notification payload (absent ⇒ none)
```

**Decision D1 — the agent's jetton wallet is a CODEC output, not a CAL field.** The on-chain message
destination is the agent's jetton wallet, deterministically derived from `(jetton_master, agent_wallet)`
by the standard jetton-wallet contract. The CAL carries `jetton_master` (logical identity); the derived
jetton-wallet **address is produced by the codec** (PFC2 codec / PP#3), exactly as `ir_to_boc` is a
publication-layer output and **not** part of the CAL hash. Rationale: keep the CAL a logical intent;
don't bake a derived address into consensus. (Alternative considered: carry the jetton wallet explicitly
— rejected: leaks a derived address into the hashed CAL.)

## 2. Validator rules (PFC2-2 implements; pinned here)

A `send_jetton` step is VALID iff:
- `amount` is an integer **> 0** (zero/negative ⇒ `W5_MALFORMED_PARAMS` analogue at validate time);
- `recipient`, `jetton_master`, `response_destination` are well-formed addresses;
- `query_id` ∈ [0, 2⁶⁴−1];
- `forward_ton_amount` ≥ 0 and **< the step's attached TON value** (it cannot exceed what's sent);
- the agent's `granted_scopes` cover a **new scope `jetton_transfer`** (Annex A; §4.3 capability gate) —
  see Decision D3.
- the base CAL envelope is UNCHANGED: single-owner authorization, `nonce`/`seqno`, single-in-flight,
  preconditions/invariants evaluated exactly as today (charter SC-5). `send_jetton` adds a verb, **not**
  a new authorization model.

A failure here is a normal validator outcome (spam-charge / capability-denied per §9.4), not a new path.

## 3. Reducer impact

**Decision D2 — reuse the existing outbound-send effect; NO new confirmation event.** The reducer treats
`send_jetton` as one authorized outbound message (same shape as `send_ton`), with the jetton specifics in
the effect payload (jetton_master, amount, recipient, forward_ton_amount). **No** `JETTON_TRANSFER_CONFIRMED`
reducer event: settlement is asynchronous and already owned **off-chain** by the M2 reconciliation registry
(§6.4 emission≠settlement). The reducer records *emission* (the CAL finalized + the action emitted), never
downstream landing. Rationale: minimize the reducer/event-log surface the freeze must absorb; reuse the
proven model. (Alternative: distinct `JETTON_TRANSFER_REQUESTED/SENT/CONFIRMED` events — rejected:
CONFIRMED is not a reducer fact, and REQUESTED/SENT duplicate the existing send effect.)

The gas weight for `send_jetton` (a structured body + nested cell) is a **new §C entry** (PFC2-2/PFC2-3),
priced above `send_ton` (more cells/bits) — a consensus-locked weight in the regenerated surface.

## 4. Canonicalization rules (the freeze-critical part)

`send_jetton` params are hashed by the **existing restricted-JCS** (integers-only, no dup keys, UTF-8
byte-order key sort) — no new canonicalization machinery. Pinned so the hash is unambiguous:

- **Hashed (in the CAL):** `jetton_master, recipient, amount, response_destination, forward_ton_amount,
  query_id` and `forward_payload` **iff present**.
- **NOT hashed:** the derived agent jetton-wallet address, the attached TON gas budget, the serialized
  TEP-74 cell — all **codec/publication-layer** outputs (D1; review §6.2/§8.3), exactly as `send_ton`'s
  `ir_to_boc` bytes are not hashed.
- **Field presence / defaults (Decision D4 — REVISED, see addendum below):** a **deterministic
  canonical normalization** fills omitted fields with fixed defaults **before** hashing, so the hashed
  CAL is always fully explicit (the restricted-JCS still sees no present-vs-absent ambiguity — it hashes
  the normalized form). Defaults: `response_destination ⇒ the agent (sender)`, `forward_ton_amount ⇒ 0`,
  `forward_payload ⇒ absent`. **`amount`, `recipient`, `jetton_master` are REQUIRED** (no safe default).
  **`query_id` is REQUIRED and explicit — NOT auto-generated** (an auto/random query_id is
  non-deterministic and would diverge across TS/Rust/Go and break vector reproducibility; see addendum).
  All integers are decimal-free canonical integers; addresses are canonical address strings (same rules
  as `send_ton`'s `to`). The normalization is identical in TS/Rust/Go (it is itself a freeze-surface
  rule, frozen in PFC2-4).
- **The ⊆ rule (publication, §7):** the codec may shorten, never extend authorization. The emitted TEP-74
  body's `amount`/`destination` MUST equal the CAL's `amount`/`recipient`; the attached TON value MUST be
  ≤ the authorized budget (`forward_ton_amount` + a bounded gas allowance), never more. Widening on either
  the jetton amount or the TON value is a freeze-reopen-class defect (PP#3 §3.1 discriminator, for jetton).

## 5. TEP-74 mapping (PFC2 codec / PP#3 implement)

The standard transfer body (`transfer#0f8a7ea5`):

| CAL field | TEP-74 body field | Cell serialization |
|---|---|---|
| (opcode) | `transfer#0f8a7ea5` | `uint32` 0x0f8a7ea5 |
| `query_id` | `query_id:uint64` | `uint64` |
| `amount` | `amount:(VarUInteger 16)` | jetton units, var-uint |
| `recipient` | `destination:MsgAddress` | the recipient's **owner** address |
| `response_destination` | `response_destination:MsgAddress` | address |
| (none) | `custom_payload:(Maybe ^Cell)` | `Maybe` = absent (not used in this increment) |
| `forward_ton_amount` | `forward_ton_amount:(VarUInteger 16)` | nanoTON, var-uint |
| `forward_payload` | `forward_payload:(Either Cell ^Cell)` | inline cell if small, else ref; absent ⇒ empty (Either left, 0 bits) |

**Outer message** (the W5 `action_send_msg`): `dest` = the agent's jetton wallet (D1, codec-derived),
`valueNano` = `forward_ton_amount` + a bounded transfer-gas allowance (the only TON authorized to leave),
`body` = the TEP-74 transfer cell above. `custom_payload` is fixed-absent this increment (a future field).

## 6. Open decisions for the architect (ratify by merging, or amend)

1. **D1** — agent jetton wallet is a codec-derived output, `jetton_master` in the CAL (recommended) — or carry the jetton wallet explicitly?
2. **D2** — reuse the send effect, no `*_CONFIRMED` reducer event (settlement = M2 off-chain) — recommended.
3. **D3** — a new `jetton_transfer` scope in Annex A (capability-gated like `ton_transfer`); its tier-implication, if any.
4. **D4 (revised, §9)** — deterministic canonical **normalization** for omitted defaults (`response_destination ⇒ sender`, `forward_ton_amount ⇒ 0`, `forward_payload ⇒ absent`); `amount`/`recipient`/`jetton_master`/**`query_id` REQUIRED-explicit** (query_id never auto-generated — a parity/determinism hazard); `custom_payload` fixed-absent this increment.

My recommendation: accept all four as written. They keep `send_jetton` a clean, isolated verb that
extends the proven `send_ton` path without touching the base authorization model (charter SC-5).

## 7. What PFC2-1 does NOT do
No change to vectors, validator, reducer, canonicalization code, or the TS/Rust/Go references. This is the
semantic contract only; PFC2-2 (validator) and PFC2-3 (reducer) implement it, PFC2-4 freezes vectors, and
PP#3 proves it on testnet.

## 8. Non-goals (explicitly OUT of scope for PFC-2)

PFC-2's first increment is `wallet.send_jetton` and nothing else. The following are **not** in this line
(each is a separate future increment or its own freeze line), so reviewers can bound the Freeze-Surface
delta precisely:

- **NFT (TEP-62)** — `wallet.send_nft` (rides the same nested-body machinery later).
- **Multisig v2.1** — `owners[]` / `threshold` (changes the authorization model — separate, higher-risk).
- **Agentic-Wallet SBT (TEP)** — on-chain identity standard.
- **Jetton mint / burn** — issuance/destruction (a master-contract privilege, not an agent transfer).
- **Jetton administration / metadata / governance** — admin ops, metadata updates, discovery (TEP-89 etc.).
- **`custom_payload`** — fixed-absent this increment (a future field; §5).
- Promoting the M2 reconciliation contract to *normative* (it stays operational/non-normative).

The only new capability PFC-2 grants is the `jetton_transfer` scope over `wallet.send_jetton` (§2, D3).

## 9. Addendum (2026-06-10) — D4 normalization + the `query_id` ruling

Refines D4 after PFC2-1 review. **Two points, pinned:**

1. **Deterministic defaults via normalization (accepted).** `response_destination ⇒ sender`,
   `forward_ton_amount ⇒ 0`, `forward_payload ⇒ absent` may be omitted by the author and are filled by a
   normalization step **before** canonical hashing. The normalization is byte-identical across TS/Rust/Go
   and is itself frozen (PFC2-4). This gives ergonomics without re-introducing present-vs-absent hash
   ambiguity — the **normalized** form is what is hashed and is always fully explicit.
2. **`query_id` is REQUIRED-explicit, never auto-generated.** An auto/random `query_id` is
   non-deterministic: TS, Rust, and Go would each produce a different value ⇒ different `cal_hash` ⇒
   cross-language parity failure (PFC2-5/6) and non-reproducible NORMATIVE vectors (PFC2-4). The author
   supplies `query_id`; the consensus layer never invents it. (If a deployment wants a derived id, it must
   derive it *deterministically* off the CAL — outside the hashed surface — but the canonical CAL carries
   the explicit value.)

This addendum corrects the original §4 phrasing ("all required-explicit"); the §4 text above now reflects it.

## 10. Related
- `pfc2-charter.md` (PFC2-0) — the line, the design-review choosing jetton, the PFC2-0..7 path.
- `cal-to-w5-mapping-review.md` §6.5 — nested transfer bodies (deferred from v0.1.0); §6.2/§8.3 publication-layer boundary.
- `orchestrator/src/w5/canonical-to-inner.ts` — the `send_ton` `encodeSendTon` this extends.
- `proof-package-2-spec.md` — the PP#2 discipline PP#3 mirrors (the ⊆ rule, the B-vs-C verdict) for jetton.
