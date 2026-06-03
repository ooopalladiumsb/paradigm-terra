# CAL → W5 mapping review — `canonical_to_inner` design (pre-code)

**Date:** 2026-06-03 · **Status:** design review, no code. Gates the Annex F (`canonical_to_inner`)
codec and feeds the `Candidate → Consensus Freeze` promotion decision (`pfc1-status-review.md`).

**Why this exists.** This is the last offline activity with the power to conclude *"our CAL→TON
assumption was wrong."* `canonical_to_inner` (`cal.action`/`cal.steps` → Wallet-V5 `InnerRequest`)
is sketched as Future Work in `ton-connect-ingress-design.md §6.1` with an unresolved "decision
point: `OutList` vs `ActionList`." Before writing the codec we resolve that fork *at the model level*
and check whether the §10 isomorphism survives the action layer (it currently only covers the
authorization envelope).

---

## 1. The fundamental question

> Is a CAL `step` an **atomic TON message**, or a **wallet (self-)action**?

Stated that way it looks like an exclusive choice. It is not — see §5. But it is the right axis,
because W5's two action arms answer it differently and the CAL verb taxonomy (§2.3) contains verbs of
*both* kinds.

## 2. CAL invariants (what must be preserved)

- **Authorization envelope** (§10.1): `agent_id`↔`wallet_id`, `nonce`↔`seqno`/`msg_seqno`,
  `expiration_tick`↔external `valid_until`, `operator_pubkey`↔`public_key`.
- **Single-in-flight per agent + nonce monotonicity** (§6.1/§6.2): one CAL advances the nonce by 1.
- **Atomicity**: a CAL is all-or-nothing under one nonce; partial application is not a state.
- **Conditional gating**: `preconditions` / `post_conditions` / `invariants` are DSL predicates that
  MUST hold for the CAL to finalize. They are enforced by the validator *before* anything publishes.
- **Trace-not-execute**: the validator never executes steps; effects arrive in the trace (§4.1).
- **Bounded Mode** (§10.2/§10.3): admitted actions are whitelist-gated and owner-escalated.

## 3. Wallet V5 relevant properties

W5's signed body is an `InnerRequest` carrying **two independent action arms** (per the V5 spec):

- `out_actions : Maybe OutList` — up to **255** standard `action_send_msg` entries (the c5 output
  action register): each emits one outbound internal message (mode + `MessageRelaxed`).
- `extended : Maybe ExtendedActionList` — wallet self-management: `add_extension`,
  `delete_extension`, `set_signature_auth_allowed`.

Plus the envelope: `wallet_id`, `valid_until` (**unix seconds**), `seqno`, root signature. Key facts:
- `seqno` is checked == stored and monotonic → native replay protection.
- `valid_until` is **wall-clock**, checked against the validating block's `now()`.
- All `out_actions` of one external are emitted in a single action phase (atomic *emission*), but
  their downstream effects settle in **separate, asynchronous** transactions.

## 4. Verb-class classification (CAL §2.3 taxonomy → W5 action arm)

This is the crux. Classifying every registered verb:

| CAL namespace.verb | On-chain nature | W5 arm |
|---|---|---|
| `wallet.send_ton` | outbound value transfer | **OutList** `action_send_msg` |
| `wallet.send_jetton` / `send_nft` | message to jetton/NFT contract w/ transfer body (TEP-74/62) | **OutList** (nested body) |
| `treasury.transfer` / `distribute_rewards` / `buyback_burn` | message to treasury contract | **OutList** |
| `governance.*` / `oracles.*` / `ptra.*` | message to the respective system contract | **OutList** |
| `agent.register` / `migrate` / `capability.update` | registry mutation — message to Registry (or extension add/remove) | **OutList** (or Extended, impl-defined) |
| `failure_mode.enter_bounded` / `exit_bounded` | toggle raw-signature admission | **ExtendedActions** (`set_signature_auth_allowed`) — §10.3 *already* pins this |
| `failure_mode.emergency_withdraw` | outbound transfer | **OutList** |
| `cal.cancel` | off-chain lifecycle only | **none** (correctly unpublishable) |

**Reading:** the overwhelming majority are *outbound messages* → OutList. A small, distinguished set
(`enter_bounded`/`exit_bounded`) is *wallet self-config* → ExtendedActions, and §10.3 has **already
established that isomorphism** (`Bounded Mode ↔ is_signature_allowed=0`). A couple are off-chain-only.

## 5. OutList vs ActionList — the comparison, and why it is a false dichotomy

| Property | OutList (`action_send_msg`) | ExtendedActions |
|---|---|---|
| CAL step ↔ intent | message verbs: step = one outbound message — **direct** | config verbs only (enter/exit_bounded): step = wallet self-mutation — **direct for those** |
| Audit simplicity | high — standard c5, every explorer/wallet decodes | lower — extension semantics are wallet-version-specific |
| §10 isomorphism | envelope (§10.1) + actions; seqno/valid_until/pubkey preserved | §10.3 already pins enter/exit_bounded ↔ set_signature_allowed |
| Multi-step CAL | ≤255 messages in **one** external, one nonce — atomic emission | extended actions batched too; a mixed CAL uses **both** arms |
| Replay semantics | `nonce`↔`msg_seqno` monotonic — preserved | same envelope seqno — preserved |
| Wallet compatibility | broad (standard W5) | narrower (extensions enabled; `set_sig_allowed` is heavier) |
| Covers v0.1.0 action set | **YES** — every end-to-end-provable verb (wallet/treasury/…) is a message verb | only `failure_mode.enter/exit_bounded` |

**Conclusion: the §6.1 "OutList vs ActionList" framing is wrong as a *global* choice.** W5's
`InnerRequest` carries both arms simultaneously; the correct codec is a **verb-class dispatch**:
message verbs → `out_actions`, wallet-config verbs → `extended`, off-chain verbs → neither. A single
mixed CAL maps to one `InnerRequest` that populates both arms.

## 6. Does the §10 isomorphism survive the action layer?

§10 is an **authorization-state** isomorphism (envelope + bounded-mode whitelist). It says nothing
about actions, and that omission is exactly where semantics can be lost. Loci, worst first:

### 6.1. ⚠ Logical tick ↔ wall-clock `valid_until` — the real model-risk finding
§6.1 sets `valid_until = unix_ts_at_tick(cal.expiration_tick)`. But **CAL expiration is a logical
tick**, validated off-chain by the frozen validator (gates 2/8: `tick > expiration_tick`), while W5
`valid_until` is **wall-clock unix seconds** checked by the chain. `unix_ts_at_tick` is **undefined**
today (cf. the known "gas wall-clock TBD" open item). If ticks are not pinned to wall-clock, a CAL the
validator accepts at tick T can carry a `valid_until` the chain rejects (or, worse, one that *extends*
the authorization beyond the off-chain verdict). **This is the one finding that could contradict an
assumption — but it does not re-open the Freeze Surface** (see §7): `expiration_tick` and its
*semantics* are frozen and consensus-binding; the tick→unix *projection* lives in the publication
layer, which §8.3 already scopes **out** of the frozen surface. The requirement is a one-directional
safety constraint on the codec, not a core change (§7).

### 6.2. Conditional logic does not cross to chain (by design — must be normative)
`preconditions`/`post_conditions`/`invariants` have **no** W5 representation. The external is the
**unconditional realization of an already-validated CAL** — the guards were discharged off-chain. So
the on-chain artifact + an external observer reconstruct *authorization + actions*, not the
conditional logic. The isomorphism is `envelope + action-projection`, never `full CAL`. This must be
stated in Annex F so no one mistakes a published external for a re-validatable CAL.

### 6.3. Read / off-chain steps have no W5 action
MCP `get_*` (read) step verbs and `cal.cancel` produce no message → they drop from the external. A CAL
interleaving reads and sends loses the read's ordering role on-chain (the read was an off-chain trace
input). Annex F MUST define: only effect-emitting steps project; read steps are codec no-ops.

### 6.4. Atomicity boundary (emission vs settlement)
CAL atomicity = one nonce, all-or-nothing *validation*. OutList gives atomic *emission* (one action
phase), but TON settles each message in a **separate async transaction**. So `cal.finalized` means
"validated + actions emitted," **not** "all downstream effects landed." This extends the §6.1
`INGRESS_REJECTED` idea: even a broadcast external doesn't guarantee downstream success — a
post-publication reconciliation (the future Registry contract) owns that, not the CAL.

### 6.5. ≤255-action cap & nested transfer bodies (codec surface, lower risk)
One external carries ≤255 `out_actions`, capping message-steps-per-CAL on-chain (CAL itself is bounded
only by gas/AST, well under 255 in practice). `send_jetton`/`send_nft` are **nested** messages
(TEP-74/62 transfer bodies), not bare transfers — real codec + wallet-compat surface. v0.1.0's
`wallet.send_ton` is a bare transfer and avoids both.

## 7. Does any of this re-open the Freeze Surface?

**No — but it pins one hard precondition on Annex F.** The frozen surface is `(cal, snapshot, trace)
→ events` + the canonical/DSL/gas/reducer layers; on-chain publication is explicitly out-of-scope
(§8.3). §6.1–§6.5 are all *publication-layer* concerns. The single constraint that touches consensus
semantics — §6.1 — is satisfiable without a core change by a **one-directional rule**:

> `unix_ts_at_tick(expiration_tick)` MUST be chosen so the chain's `valid_until` check can never
> **accept** an external whose CAL the validator would have **expired**, nor **extend** authorization
> beyond the off-chain verdict. I.e. the derived `valid_until` is a conservative wall-clock *lower
> bound* of the tick's real-time horizon, never an extension.

If that rule cannot be met (e.g. ticks are wall-clock-independent and unmappable), *then* it escalates
to a core question — but the expected outcome is a publication-layer codec constraint, leaving PFC-1's
Freeze Candidate intact.

## 8. Normative recommendation (for Annex F)

1. **`canonical_to_inner` is a verb-class dispatch**, not a single-arm choice. Output: a W5
   `InnerRequest` with `out_actions` for message verbs and `extended` for wallet-config verbs.
2. **v0.1.0 implements the OutList arm only** — it covers the entire currently-publishable action set
   (every registered scoped verb except `enter/exit_bounded` is a message verb; `wallet.send_ton`, the
   only end-to-end-proven action, is a bare-transfer `action_send_msg`). The ExtendedActions arm is
   *specified but stubbed* until bounded-mode toggles publish on-chain (§10.3 surface).
3. **Annex F MUST state the publication-layer boundary** (§6.2): the external is the unconditional
   post-validation action projection, not a re-validatable CAL; reads/`cal.cancel` are no-ops (§6.3).
4. **Adopt the §6.1 one-directional `valid_until` rule (§7)** as a hard codec precondition, and record
   `unix_ts_at_tick` as the gating design item (shared with the gas wall-clock open item).
5. Defer nested-transfer bodies (`send_jetton`/`send_nft`) and the >255-action case to when those
   verbs are first published; v0.1.0 need not encode them.

## 9. Open decision for the architect

The fork is resolved at the model level (verb-class dispatch, OutList-only for v0.1.0). The one item
that needs an explicit ruling before code:

> **Is the tick ↔ wall-clock `valid_until` mapping (§6.1) accepted as a publication-layer constraint
> (§7 one-directional rule) — keeping the Freeze Candidate intact — or does it warrant a core review
> of `expiration_tick` semantics first?**

My read: publication-layer (the §7 rule is sufficient and does not touch frozen code). If accepted,
Annex F can be written + implemented (OutList arm) offline; full validation remains on-chain (H3.1).

## 10. Implementation status (2026-06-03)

Architect ruling received: the tick↔wall-clock mapping is accepted as a **publication-layer
constraint** (`TON-valid ⊆ CAL-valid` — publication may shorten, never extend authorization), Freeze
Candidate intact. Annex F OutList arm implemented + tested offline:
- `orchestrator/src/w5/canonical-to-inner.ts` — `canonicalToInner(cal) → InnerRequest` (IR form, per
  §3.1: typed OutList of `action_send_msg`, **not** serialized BoC — `ir_to_boc` is the network leg).
  Verb-class dispatch; only `wallet.send_ton` has a v0.1.0 body encoder; exact-value send mode (no
  carry bits); config/unknown verbs rejected; read/`cancel` are no-ops; ≤255-action guard.
- `orchestrator/test/w5-codec.test.ts` — 10/10 invariant tests: faithful value+dest, no fan-out, no
  authorization widening, explicit rejection of unknown/config/unimplemented/malformed verbs,
  read/cancel no-ops. Typecheck clean; full orchestrator suite 25/25.

DRAFT-tier (publication layer, §8.3 out-of-scope of the freeze). Rust/Go parity ports + golden
vectors come if/when Annex F is promoted past DRAFT — gated on the on-chain leg (H3.1) that validates
the deferred `ir_to_boc` serialization.

## 11. Related
- `ton-connect-ingress-design.md` §6.1 (the sketch this resolves), §6/§8 (W5/V5 refs).
- `cal-validator-design.md` §10 (authorization isomorphism — extended here to the action layer).
- `pfc1-status-review.md` (the promotion decision this feeds).
- CAL Exec Spec §8.3 (publication out-of-scope), §2.3 (action taxonomy), §10.2/§10.3 (Bounded Mode).
