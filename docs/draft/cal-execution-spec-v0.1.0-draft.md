# CAL Execution Specification v0.1.0-draft

**Status:** Draft, co-ratified under Tier 3 with Paradigm Terra Constitution v0.10.0-draft.
**Date:** 2026-05-23
**Authoritative dependencies:** Constitution v0.10.0-draft, Canonical Encoding Specification v1.3 (Consensus-Freeze), DSL Specification v0.1.0-draft.
**License:** MIT.

This document is the normative reference for the lifecycle, validation, signing, gas accounting, and event semantics of the Constitutional Action Language (CAL) inside Paradigm Terra. Until ratification, it is published as a *draft* and has no normative force; the in-force CAL semantics remain those of Constitution v0.9.5 §IV.

---

## 1. Abstract

The Constitutional Action Language (CAL) is the **only** mechanism through which the Paradigm Terra protocol mutates state. This specification defines:

- the **structure** of a CAL blob (§2);
- its **lifecycle** as an on-chain state machine with one event per stage (§3);
- the **validator** role and the deterministic snapshot it reads (§4);
- the **receipt** event format (§5);
- the **concurrency discipline** that serializes a single agent's CAL stream (§6);
- the **event reducer** and **state root** computation that close the event-sourcing loop (§7);
- the **signing model** with operator/owner key separation (§8);
- the **two-stage gas model** (TON for ingress, PTRA for validation and execution) (§9);
- the runtime semantics of **Bounded Mode** as a sub-mode of the failure state machine (§10);
- a **backwards-compatibility** layer for pre-PTRA CAL blobs (§11).

All normative MUST / SHOULD / MAY conform to RFC 2119.

---

## 2. CAL Structure

### 2.1. Wire format

A CAL is a canonically encoded object (Canonical Encoding v1.3 §4 restricted JCS) with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cal_version` | `string` | yes | Semantic version; `"0.1.0"` for this spec. |
| `action` | `string` | yes | `namespace.verb` from the registered taxonomy (§2.3). |
| `agent_id` | `string` | yes | Canonical raw TON address of the agent. |
| `nonce` | `uint64` | yes | Monotonically increasing per-agent counter; MUST equal `state.cal.nonces[agent_id] + 1` at VALIDATED. |
| `expiration_tick` | `uint64` | yes | Last tick at which the CAL may be VALIDATED **and** EXECUTED. |
| `preconditions` | `DSL expr` | yes | Constraint DSL expression evaluated against the snapshot (§4.2). |
| `invariants` | `list<DSL expr>` | yes | List of DSL expressions evaluated against `state.before` and `state.after` at FINALIZED time. |
| `steps` | `list<Step>` | yes | Ordered sequence; each step is `{verb, params, post_conditions}`. |
| `receipt_required` | `bool` | yes | If true, the CAL is rejected at VALIDATED unless a receipt event slot is reservable. |
| `signatures` | `Signatures` | yes | See §8. |
| `compatibility_pragma` | `string` | no | Reserved for legacy CAL; see §11. |

A `Step` is:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `verb` | `string` | yes | `namespace.verb` from §2.3; MUST be consistent with the CAL's top-level `action`. |
| `params` | `object` | yes | Canonical JSON of step parameters. |
| `post_conditions` | `list<DSL expr>` | no | DSL expressions evaluated immediately after the step applies (DSL Spec §4). |

`Signatures` is:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `operator_sig` | `bytes` | yes | Ed25519 signature by the agent's operator key over the canonical CAL bytes excluding `signatures.*`. |
| `owner_sig` | `bytes` | conditional | Required if `action ∈ OWNER_REQUIRED_ACTIONS` (§8.2) or if `state.failure_mode.is_bounded_mode == true` (§10.4). |
| `sponsor_sig` | `bytes` | optional | Gas Legacy Bridge sponsor signature (§11.3). |

### 2.2. Canonical CAL hash

```
CAL_HASH = SHA256("PARADIGM_TERRA_CAL_V1" || canonical_bytes(cal_excluding_signatures))
```

`CAL_HASH` is the key used in `state.cal.in_flight[cal_hash]`.

### 2.3. Action taxonomy (registered)

`action` is drawn from a closed enum maintained as part of the constitution and amendable by Tier 2. Initial registry (non-exhaustive; the final registry MUST be published as Annex A of this spec at Conformance Freeze):

| Namespace | Verbs |
|-----------|-------|
| `wallet` | `send_ton`, `send_jetton`, `send_nft` |
| `agent` | `register`, `migrate`, `freeze`, `unfreeze` |
| `capability` | `update`, `temporal_boost_request`, `temporal_boost_release` |
| `treasury` | `transfer`, `distribute_rewards`, `buyback_burn` |
| `governance` | `propose_amendment`, `vote`, `vote_as_agent`, `finalize_amendment` |
| `oracles` | `submit_feed`, `slash`, `force_update` |
| `ptra` | `stake`, `unstake`, `claim_rewards` |
| `failure_mode` | `emergency_withdraw`, `enter_bounded`, `exit_bounded` |
| `cal` | `cancel` |

Implementations MUST reject any CAL whose `action` is not in the registry with `VALIDATION_ERROR / UNKNOWN_ACTION`.

---

## 3. Lifecycle State Machine

### 3.1. States and transitions

```
              ┌──────────┐ ingress (TON gas paid)
              │ CREATED  │ ◀────── client / MCP
              └────┬─────┘
                   │ operator_sig (+ owner_sig if required)
                   ▼
              ┌──────────┐  validator snapshot read
              │  SIGNED  │
              └────┬─────┘
                   │  preconditions OK · capability OK
                   │  nonce == nonces[agent_id]+1
                   │  current_tick ≤ expiration_tick
                   │  Flat_Validation_Fee debited
                   ▼
              ┌────────────┐
              │ VALIDATED  │ ────── on fail ──▶ FAILED (terminal)
              └────┬───────┘
                   │ steps executed in order
                   │ each step: post_conditions evaluated
                   ▼
              ┌────────────┐
              │ EXECUTED   │ ────── on rollback ──▶ FAILED (terminal)
              └────┬───────┘
                   │ invariants over state.before/state.after hold
                   │ Dynamic Gas debited
                   ▼
              ┌────────────┐
              │ SETTLED    │ ────── on invariant break ──▶ FAILED (terminal)
              └────┬───────┘
                   │ receipt event written
                   ▼
              ┌────────────┐
              │ FINALIZED  │
              └────────────┘
```

Terminal states are `FINALIZED`, `FAILED`, `EXPIRED`. From any non-terminal state, if `current_tick > expiration_tick` before the next stage's event is appended, the CAL transitions to `EXPIRED` with an `cal.expired` event and `nonce` is burned identically to FAILED (§3.5).

### 3.2. Stage event types

Each stage transition emits one canonical event appended to the Event Log. All events use domain tag `PARADIGM_TERRA_EVENTCHAIN_V1` for chain hashing; the inner `event_type` is one of:

| `event_type` | Stage transition |
|--------------|------------------|
| `cal.created` | external → CREATED |
| `cal.signed` | CREATED → SIGNED |
| `cal.validated` | SIGNED → VALIDATED |
| `cal.executed` | VALIDATED → EXECUTED |
| `cal.settled` | EXECUTED → SETTLED |
| `cal.finalized` | SETTLED → FINALIZED (also serves as the receipt; see §5) |
| `cal.failed` | * → FAILED |
| `cal.expired` | * → EXPIRED |

Implementations MUST NOT emit two events for the same `(cal_hash, event_type)` pair.

### 3.3. Snapshot semantics

Validators read **the snapshot of the last finalized tick** (Q2.2). Concretely:

```
snapshot := materialize(events_up_to(state.tick.current - 1))
```

The snapshot is deterministic across all conforming validators. Any in-flight CAL state from the current tick MUST NOT influence the snapshot.

### 3.4. Expiration semantics

- At VALIDATED: `current_tick ≤ expiration_tick` MUST hold; otherwise `cal.expired`.
- After SIGNED, between VALIDATED and FINALIZED, expiration is re-checked at the beginning of each stage transition. If exceeded, `cal.expired` is emitted instead of the next stage event.

### 3.5. Failure semantics (Q1.3 — all-or-nothing)

On any failure (precondition false, invariant false, step error, post-condition false, out-of-gas during execution), the runtime:

1. Discards all step effects (rollback to `state.before`).
2. Increments `state.cal.nonces[agent_id]` (burns the nonce; anti-replay).
3. Removes `cal_hash` from `state.cal.in_flight`.
4. Emits a `cal.failed` event with fields `{cal_hash, reason_code, reason_detail, gas_consumed_ptra, ton_ingress_fee_paid}`.

`reason_code` is drawn from a closed enum:

| Code | Meaning |
|------|---------|
| `PRECOND_FALSE` | A precondition evaluated to FALSE. |
| `PRECOND_ERROR` | A precondition raised DSL ERROR. |
| `CAPABILITY_DENIED` | Agent profile does not grant the action. |
| `NONCE_MISMATCH` | `nonce ≠ nonces[agent_id] + 1`. |
| `STEP_ERROR` | Step verb failed (MCP error, contract revert). |
| `POSTCOND_FALSE` | A step's post-condition evaluated FALSE. |
| `INVARIANT_FALSE` | A top-level invariant evaluated FALSE. |
| `INSUFFICIENT_ESCROW` | Agent balance below the §9.3 escrow requirement (`Flat_Validation_Fee + Max_Expected_Dynamic_Gas`) at the admission gate — rejected before VALIDATED, no PTRA taken. |
| `OUT_OF_GAS` | Dynamic gas consumed during execution exceeds the escrowed `Max_Expected_Dynamic_Gas` budget (post-VALIDATED overrun). |
| `UNKNOWN_ACTION` | `action` not in §2.3 registry. |
| `BOUNDED_BLOCKED` | Action not in Bounded Mode whitelist (§10.2). |
| `SCHEMA_MISMATCH` | MCP schema hash mismatch. |

### 3.6. Expiration vs failure

`EXPIRED` is distinct from `FAILED`:
- `EXPIRED` does not assign blame for content; it indicates the agent failed to drive the CAL through stages in time.
- `FAILED` is content-driven (precondition false, invariant violation, etc.).
- Both burn the nonce and remove `cal_hash` from `in_flight`.

---

## 4. Validator Role

### 4.1. Definition

A **validator** is a node participating in protocol consensus that:

1. Reads the deterministic snapshot of the last finalized tick (§3.3).
2. Re-validates `signatures` over the canonical CAL bytes.
3. Evaluates `preconditions` against the snapshot.
4. Checks the agent's capability profile against the action's required scopes (§4.3).
5. Verifies nonce monotonicity and expiration.
6. Debits `Flat_Validation_Fee` from `state.ptra.balances[agent_id]` (§9.3).
7. Appends `cal.validated` (or `cal.failed` with the appropriate reason) to the Event Log.

Validators do not execute steps; execution is a separate stage performed by the same validator set as a single atomic step.

This formalizes Constitution v0.9.5 §5.3: the validator is the actor that enforces "before each MCP call, conformance with the agent profile is checked; three violations within 100 ticks → automatic freeze." This spec adds: violation counters are kept in `state.governance.capture_guard_counters[agent_id]` and reset on `agent.unfreeze` events.

### 4.2. State view at VALIDATED (Q2.2)

```
snapshot_state := state_at(tick = state.tick.current - 1)
```

Validators MUST NOT read any field of `state` that is mutated during the current tick. All reads go through the snapshot.

### 4.3. Capability check

For each `verb` in `steps[*].verb`, the validator computes the set of required `asset_scope` flags, governance scope, and treasury access level from the MCP method ↔ scope table (Constitution §V) and verifies that the agent's capability profile grants each required flag. Missing any required flag → `cal.failed` with `CAPABILITY_DENIED`.

### 4.4. MCP schema hash check

If `state.registry.mcp_schema_hash` does not match the validator's locally pinned hash, validation fails with `SCHEMA_MISMATCH` and the system enters `MCP_DEGRADED_MODE` per Constitution §VI.

#### 4.4.1. Schema hash construction (normative)

The MCP schema hash is derived from the **lexicographically sorted set of MCP tool names**, and **only the names**. Tool descriptions, parameter schemas, and behavioural metadata are explicitly excluded so that documentation churn in the upstream `@ton/mcp` package cannot invalidate the hash; only addition or removal of a tool does.

```
MCP_SCHEMA_V1_TOOLSET := canonical_json(sorted_lex(tool_names))
MCP_SCHEMA_HASH       := SHA256("PARADIGM_TERRA_MCP_V1" || MCP_SCHEMA_V1_TOOLSET)
```

where:

- `tool_names` is the set of `name` strings exported by the pinned `@ton/mcp` runtime;
- `sorted_lex` is byte-wise ascending sort of the UTF-8-encoded names (same order rule used for canonical JSON object keys, Canonical Encoding v1.3 §4);
- `canonical_json` is the Restricted JCS profile defined in Canonical Encoding v1.3 §4 (no whitespace, lex-sorted keys, no surrogate pairs, NFC string contents);
- `"PARADIGM_TERRA_MCP_V1"` is the §7.1 domain tag, UTF-8 bytes, no terminator;
- `||` is byte concatenation.

The validator carries `MCP_SCHEMA_HASH` as a pinned constant; `state.registry.mcp_schema_hash` carries the on-chain quorum-acknowledged value (set via Tier 1/2 amendments per Constitution §6.bis); §4.4 compares the two byte-for-byte.

#### 4.4.2. Pinned toolchain

```
@ton/mcp@0.1.15-alpha.16
```

This is the pinned runtime against which `MCP_SCHEMA_V1_TOOLSET` is computed for the v0.1.0-draft profile. The concrete byte value of `MCP_SCHEMA_HASH(0.1.15-alpha.16)` is recorded by the validator's first reference run, frozen into the validator handshake, and included in the validator golden vectors as the `mcp_schema_hash` field. Patch/minor/major bump policy is governed by Constitution §6.bis "Pinning стратегия MCP схемы".

---

## 5. Receipts

### 5.1. Receipt as `cal.finalized` event (Q1.6)

A receipt is the `cal.finalized` event itself. There is no separate receipt contract or registry. Fields:

```
cal.finalized {
  cal_hash:              bytes32,
  agent_id:              address,
  nonce:                 uint64,
  tick_finalized:        uint64,
  state_root_before:     bytes32,
  state_root_after:      bytes32,
  gas_consumed_ptra:     uint256,
  ton_ingress_fee_paid:  uint256,
  steps_applied:         uint16,
  invariants_checked:    uint16
}
```

Receipt hash:

```
RECEIPT_HASH = SHA256("PARADIGM_TERRA_RECEIPT_V1" || canonical_bytes(cal.finalized_event))
```

This `RECEIPT_HASH` is the value an agent or external observer references when proving that a CAL was successfully applied.

### 5.2. Receipt for FAILED / EXPIRED

`cal.failed` and `cal.expired` events serve as negative receipts; they share the receipt hashing scheme but with the corresponding event type included in the hashed bytes. External observers SHOULD treat any of the three terminal events as proof of CAL termination.

---

## 6. Concurrency & Nonce Discipline (Q1.5)

### 6.1. Per-agent serialization

For each `agent_id`, at most **one** CAL may be in flight at any tick. Concretely:

- A `cal.signed` event for `agent_id` is rejected if `state.cal.in_flight` already contains any `cal_hash` with the same `agent_id`.
- A new CAL is admitted only after the previous CAL reaches a terminal state (`FINALIZED`, `FAILED`, `EXPIRED`).

### 6.2. Nonce rules

- A CAL's `nonce` MUST equal `state.cal.nonces[agent_id] + 1` at VALIDATED.
- On any terminal transition (FINALIZED, FAILED, EXPIRED), `state.cal.nonces[agent_id]` is incremented by exactly 1.
- The `nonce` field is included in `CAL_HASH`, so the same payload submitted with a stale nonce produces a different hash and is rejected separately.

### 6.3. Cancellation

An agent MAY cancel a SIGNED-but-not-VALIDATED CAL by issuing a `cal.cancel` CAL (a meta-action) whose `params.target_cal_hash` references the in-flight CAL. The cancellation CAL itself consumes the next nonce. The targeted CAL transitions to `FAILED` with reason `CANCELLED`. Cancellation is forbidden after VALIDATED.

---

## 7. Event Reducer & State Root

### 7.1. Reducer signature (Q2.3)

```
apply : (State, Event) → State
```

`apply` is a pure total function (modulo `ERROR` returned as a typed value, not an exception). The body is a `switch` over `event.type`. **The normative table is Annex B (§14), populated DRAFT 2026-05-28.** The summary below is informative; consult Annex B for the precise mutations, field requirements, and error codes:

| `event.type` | Summary |
|--------------|----------------|
| `cal.created` | append `cal_hash → CREATED` to `state.cal.in_flight`; enforce one-CAL-per-agent (§6.1) |
| `cal.signed` | `stage := SIGNED` |
| `cal.validated` | debit `state.ptra.balances[agent_id] -= escrow_ptra` (= `Flat_Validation_Fee + Max_Expected_Dynamic_Gas`, §9.3); `stage := VALIDATED` |
| `cal.executed` | stage step effects + `gas_consumed_ptra` (commit happens at finalize) |
| `cal.settled` | `stage := SETTLED` |
| `cal.finalized` | commit staged effects; refund unused gas; add `escrow − refund` to treasury; bump nonce; remove from `in_flight` |
| `cal.failed` / `cal.expired` | branch on stage: pre-VALIDATED debits §9.4 spam fee, post-VALIDATED settles like finalize but drops effects; bump nonce; remove from `in_flight` |
| `ptra.transferred` | mirror of TEP-74 transfer (§7.4); update `state.ptra.balances` |
| `ptra.shadow_init` | idempotent zero-init for an address |
| `oracle.feed_submitted` | update `state.oracles.feeds[symbol]` after median aggregation |
| `tick.advanced` | `state.tick.current := new_tick`; recompute `is_bounded_mode` |

### 7.2. Determinism

For any two conforming implementations, `apply` MUST produce identical resulting state bytes for identical (state, event) inputs. This is a Tier 3 invariant and is enforced at conformance-test time via differential fuzzing.

### 7.3. State root computation (Q2.4)

The state root is a binary Merkle tree over the canonical serialization of each top-level namespace, ordered lexicographically by namespace name (UTF-8 byte order).

```
namespaces := sorted([
  "state.cal",
  "state.failure_mode",
  "state.governance",
  "state.oracles",
  "state.ptra",
  "state.registry",
  "state.tick",
  "state.treasury"
])

leaves := [SHA256("PARADIGM_TERRA_STATE_ROOT_V1" ||
                  uint16_be(len(name)) ||
                  utf8_bytes(name) ||
                  SHA256("PARADIGM_TERRA_STATE_V1" || canonical_bytes(state[name])))
           for name in namespaces]

STATE_ROOT := binary_merkle(leaves, domain_tag="PARADIGM_TERRA_STATE_ROOT_V1")
```

Where `binary_merkle` is the algorithm defined in Canonical Encoding v1.3 §6.3, with the leaf and node hashing constants substituted by the `STATE_ROOT_V1` domain tag.

Adding `PARADIGM_TERRA_STATE_ROOT_V1` to the domain tag registry requires a Tier 2 amendment to Canonical Encoding v1.3 §7.1.

### 7.4. External event mirroring (Q2.5)

Paradigm Terra mirrors all TEP-74 PTRA jetton transfers as native events:

```
ptra.transferred {
  from_jetton_wallet: address,
  to_jetton_wallet:   address,
  amount_nano_ptra:   uint256,
  forward_payload_hash: bytes32,
  ton_lt:             uint64,
  ton_block_seqno:    uint64,
  external_tx_hash:   bytes32
}
```

Hashed with `PARADIGM_TERRA_JETTON_TRANSFER_V1` (Canonical Encoding v1.3 §3.5). Mirroring is performed by validators reading the canonical TON event stream; a reorg in TON within finality (~1 second post-Catchain 2.0) MUST NOT produce a mirrored event. Mirrored events feed into `apply` like any other event.

---

## 8. Signing Model

### 8.1. Two key tiers (Q3.3)

Every agent has two distinct Ed25519 key pairs (per Constitution §XI Agentic Wallet):

- **Operator key** — controlled by the agent runtime; signs CAL by default.
- **Owner key** — controlled by the agent's human/multisig/DAO owner; required co-sign for high-stakes actions.

### 8.2. `OWNER_REQUIRED_ACTIONS` (initial enum, Tier 2 amendable)

```
OWNER_REQUIRED_ACTIONS := [
  "capability.update",
  "agent.migrate",
  "treasury.transfer",
  "governance.vote_as_agent",
  "governance.propose_amendment",
  "ptra.stake",
  "ptra.unstake",
  "failure_mode.emergency_withdraw"
]
```

For any `action ∈ OWNER_REQUIRED_ACTIONS`, `signatures.owner_sig` MUST be present and valid; missing or invalid → `cal.failed` with `CAPABILITY_DENIED`.

Additionally, any `wallet.send_ton` step whose `params.amount > capability.max_transfer_per_tick / 2` also requires `owner_sig` (a runtime, value-driven check, not part of the static enum).

### 8.3. Signature canonicalization

The signed payload is the canonical bytes of the CAL **with** `signatures` field omitted entirely (per Canonical Encoding §3.4 omit-on-null rule). Each signature is verified independently; signature order in the `Signatures` object is fixed by canonical key ordering.

### 8.4. Sponsor signatures

Sponsor signatures (§11.3) are validated separately and do not contribute to capability authorization; they only affect gas accounting.

---

## 9. Gas Model

### 9.1. Stage-by-stage payment table

| Stage | Payer | Currency | Amount | Failure behavior |
|-------|-------|----------|--------|------------------|
| CREATED → SIGNED (mempool ingress) | Initiator | **TON** | TON network fee | If CAL is malformed or signature invalid, ingress fee is consumed; CAL never reaches the Event Log. |
| SIGNED → VALIDATED | Agent | **PTRA** | `Flat_Validation_Fee` (upfront) | If preconditions fail, fee is consumed as anti-spam charge; CAL → FAILED. |
| VALIDATED → EXECUTED | Agent | **PTRA** | Dynamic gas (per DSL op, per MCP call, per invariant) | If gas exhausted, full rollback; consumed gas burned to validators. |
| EXECUTED → SETTLED | Agent | **PTRA** | State rent (proportional to state mutation size) | If state rent insufficient, rollback; gas burned. |
| SETTLED → FINALIZED | — | — | Free | — |

### 9.2. Gas unit pricing

The table below pins the gas-unit weights normatively (informative copy; the
authoritative composition + invariants live in Annex C, §14). Wall-clock
calibration across the three reference implementations is deferred to
Conformance Freeze (Annex C.3).

| Operation class | Gas units |
|-----------------|-----------|
| DSL binary op (eq/lt/add/...) | 1 |
| DSL `contains_key` | 10 |
| DSL `size` | 20 |
| DSL path resolution (per segment) | 2 |
| DSL gate op (`requires_scope`, `is_owner_required`) | 5 |
| MCP read-only call (verb starting with `get_`) | 50 |
| MCP write call (any other verb) | 200 |
| Invariant evaluation (per expression) | base 5 + DSL cost |
| State rent | 1 per byte written |

Conversion `gas_units → nano_PTRA` is governed by `state.governance.gas_price_nano_ptra_per_unit`, a Tier 1 amendable parameter (default at genesis: `1000`, i.e. 1 µPTRA per unit).

### 9.3. Upfront deposit

At SIGNED → VALIDATED transition, the validator MUST verify:

```
state.ptra.balances[agent_id] ≥ Flat_Validation_Fee + Max_Expected_Dynamic_Gas
```

`Max_Expected_Dynamic_Gas` is an upper bound declared in the CAL (`gas_limit_ptra` optional field, default = `Flat_Validation_Fee × 100`). The full amount is escrowed; unused portion is refunded at FINALIZED.

### 9.4. Refunds and slashing

- FINALIZED: unused gas refunded; `Flat_Validation_Fee` retained by validators.
- FAILED with `PRECOND_FALSE` or `CAPABILITY_DENIED`: `Flat_Validation_Fee` retained (spam charge); no dynamic gas consumed (validation stopped before execution).
- FAILED with `STEP_ERROR`, `POSTCOND_FALSE`, `INVARIANT_FALSE`, `OUT_OF_GAS` (execution overrun): `Flat_Validation_Fee` + actually consumed dynamic gas retained; rollback applied.
- FAILED with `UNKNOWN_ACTION`, `NONCE_MISMATCH`, `PRECOND_ERROR`, or `INSUFFICIENT_ESCROW` (the §9.3 escrow shortfall): **no PTRA consumed** — these are ingress-class (§9.1, the TON ingress fee is the anti-spam) or unaffordable, so no `Flat_Validation_Fee` can be retained.
- EXPIRED before VALIDATED: no PTRA consumed (TON ingress fee only).
- EXPIRED after VALIDATED: `Flat_Validation_Fee` retained.

> **Spam-charge availability (§9.4 Tier-2 clarification, 2026-05-26).** The
> precondition and capability gates are evaluated *before* the §9.3 escrow gate,
> so at a `PRECOND_FALSE`/`CAPABILITY_DENIED` rejection the agent is not yet
> guaranteed to hold `Flat_Validation_Fee`. The retained spam charge is therefore
> `min(Flat_Validation_Fee, state.ptra.balances[agent_id])` — the most that can be
> honestly taken before escrow. The full fee is guaranteed only once §9.3 passes.
> This pre-VALIDATED charge is non-refundable, booked at the `cal.failed` event
> (the CAL never reaches VALIDATED, so it is not escrowed at `cal.validated`).

Retained gas flows to `state.treasury.collected_fees_window`, then distributed per Constitution §VIII.

---

## 10. Bounded Mode

### 10.1. Trigger conditions (deterministic)

```
state.failure_mode.is_bounded_mode := (
  oracle_response_rate_window < 0.70  OR
  state.treasury.nav_delta_per_tick < -X%  OR
  state.failure_mode.capture_guard_counters["any"] ≥ THRESHOLD
)
```

`X` and `THRESHOLD` are Tier 1 amendable parameters. The flag is recomputed at each tick boundary by the reducer; transitions emit `failure_mode.enter_bounded` or `failure_mode.exit_bounded` events.

### 10.2. Action whitelist

When `is_bounded_mode == true`, the validator MUST reject any CAL whose `action` is not in:

```
BOUNDED_MODE_WHITELIST := [
  "failure_mode.emergency_withdraw",
  "failure_mode.exit_bounded",
  "oracles.force_update",
  "oracles.submit_feed",
  "agent.freeze",
  "cal.cancel"
]
```

with reason `BOUNDED_BLOCKED`. The whitelist is Tier 1 amendable.

### 10.3. Emergency invariants

For every CAL admitted in Bounded Mode, the runtime injects the **three-invariant emergency set** on top of whatever the CAL declares: developer-fund non-decreasing, NAV non-decreasing, and `is_bounded_mode` pinned `true` for the duration of the CAL. The verbatim set is pinned by **DSL Spec v0.1.0-draft §7.1** and reproduced here by **Annex D.2** (§14). Violation → FAILED with `INVARIANT_FALSE`.

### 10.4. Signature escalation

In Bounded Mode, every action is treated as if it were in `OWNER_REQUIRED_ACTIONS`. Missing `owner_sig` → `cal.failed` with `CAPABILITY_DENIED`.

### 10.5. Exit conditions

Exiting Bounded Mode requires:
- Trigger conditions (§10.1) clear for ≥ 100 consecutive ticks, **and**
- An explicit `failure_mode.exit_bounded` CAL signed by a quorum of governance slot holders (Tier 1 vote, single-tick window).

The emitted `failure_mode.exit_bounded` event sets `state.failure_mode.is_bounded_mode = false`.

---

## 11. Backwards Compatibility (pre-PTRA CAL)

### 11.1. Shadow balances

For any `agent_id` present in `state.registry.agents` but absent from `state.ptra.balances`, the reducer MUST initialize `state.ptra.balances[agent_id] = 0` on first read. This is a no-op for replay determinism (the initialization event is implicit and emitted as `ptra.shadow_init` at the tick of first reference).

### 11.2. `#pragma compatibility_mode`

A CAL MAY include `compatibility_pragma: "v0.9.5"`. When set, the validator routes capability checks through a **legacy reducer**:

```
legacy_capability_check(agent_id, action) := agent_id ∈ GENESIS_VALIDATOR_SET
```

`GENESIS_VALIDATOR_SET` is a constitutional constant fixed at genesis. The pragma is honored only during the 1000-tick compatibility window following v0.10.0 ratification; afterwards the pragma is ignored and capability checks fall back to the standard rules of §4.3.

### 11.3. Gas Legacy Bridge

A CAL MAY include `signatures.sponsor_sig` from a third party. When present:

1. The sponsor's `state.ptra.balances[sponsor_addr]` is debited for `Flat_Validation_Fee` and dynamic gas instead of the agent's balance.
2. The transport layer simultaneously transfers an equivalent nanoTON amount from the agent (or from a designated payer) to the sponsor, computed via the canonical PTRA/TON ratio.
3. The bridge is permitted only during the 1000-tick compatibility window unless explicitly extended by Tier 1 amendment.

---

## 12. Examples

### 12.1. Minimal happy-path CAL

```json
{
  "cal_version": "0.1.0",
  "action": "wallet.send_ton",
  "agent_id": "0:83dfd552e63729b472fc4e4a8f8f83d4a8f4f3a3e3e3a3e3e3a3e3e3a3e3e3a3",
  "nonce": 42,
  "expiration_tick": 1050000,
  "preconditions": {
    "op": "gte",
    "lhs": {"var": "state.ptra.balances.0:83dfd552..."},
    "rhs": {"const": 100000000}
  },
  "invariants": [
    {
      "op": "eq",
      "lhs": {"var": "state.after.registry.agents.0:83dfd552....frozen_until"},
      "rhs": {"var": "state.before.registry.agents.0:83dfd552....frozen_until"}
    }
  ],
  "steps": [
    {
      "verb": "wallet.send_ton",
      "params": {
        "to": "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf",
        "amount_nano_ton": 50000000000
      },
      "post_conditions": [
        {
          "op": "lt",
          "lhs": {"var": "state.after.registry.agents.0:83dfd552....wallet_balance_ton"},
          "rhs": {"var": "state.before.registry.agents.0:83dfd552....wallet_balance_ton"}
        }
      ]
    }
  ],
  "receipt_required": true,
  "signatures": {
    "operator_sig": "0x..."
  }
}
```

### 12.2. Owner-required CAL (capability update)

```json
{
  "cal_version": "0.1.0",
  "action": "capability.update",
  "agent_id": "0:83dfd552...",
  "nonce": 43,
  "expiration_tick": 1050100,
  "preconditions": {
    "op": "eq",
    "lhs": {"var": "state.registry.agents.0:83dfd552....frozen_until"},
    "rhs": {"const": 0}
  },
  "invariants": [],
  "steps": [
    {
      "verb": "capability.update",
      "params": {
        "field": "asset_scope.ptra_stake",
        "value": true
      }
    }
  ],
  "receipt_required": true,
  "signatures": {
    "operator_sig": "0x...",
    "owner_sig":    "0x..."
  }
}
```

Missing `owner_sig` → `CAPABILITY_DENIED` even if `operator_sig` is valid.

### 12.3. Bounded Mode emergency withdrawal

```json
{
  "cal_version": "0.1.0",
  "action": "failure_mode.emergency_withdraw",
  "agent_id": "0:slot_holder_address",
  "nonce": 7,
  "expiration_tick": 1050001,
  "preconditions": {
    "op": "eq",
    "lhs": {"var": "state.failure_mode.is_bounded_mode"},
    "rhs": {"const": true}
  },
  "invariants": [],
  "steps": [
    {
      "verb": "failure_mode.emergency_withdraw",
      "params": {
        "amount_nano_ton": 100000000000,
        "destination": "0:..."
      }
    }
  ],
  "receipt_required": true,
  "signatures": {
    "operator_sig": "0x...",
    "owner_sig":    "0x..."
  }
}
```

Note: in Bounded Mode the runtime injects the `developer_fund_balance` non-decreasing invariant (§10.3) even though the CAL declares `invariants: []`.

### 12.4. Receipt event

```json
{
  "event_type": "cal.finalized",
  "cal_hash":   "0x9f8e7d6c...",
  "agent_id":   "0:83dfd552...",
  "nonce":      42,
  "tick_finalized": 1049982,
  "state_root_before": "0xaaaa...",
  "state_root_after":  "0xbbbb...",
  "gas_consumed_ptra": 12345,
  "ton_ingress_fee_paid": 5000000,
  "steps_applied": 1,
  "invariants_checked": 1
}
```

### 12.5. Failure receipt (out-of-gas)

```json
{
  "event_type": "cal.failed",
  "cal_hash":   "0x4a3b2c1d...",
  "agent_id":   "0:83dfd552...",
  "nonce":      44,
  "tick_failed": 1050200,
  "reason_code": "OUT_OF_GAS",
  "reason_detail": "step 0 consumed 850000 of 800000 budgeted units",
  "gas_consumed_ptra": 800000,
  "ton_ingress_fee_paid": 5000000
}
```

### 12.6. Gas accounting walk-through

A `wallet.send_ton` CAL with:
- 3 DSL precondition ops (`gte`, `eq`, `and` of size 2) → 5 units
- 1 MCP write call (`send_ton`) → 200 units
- 1 invariant with 1 DSL op → 5 + 1 = 6 units
- 80 bytes of state writes → 80 units

Total dynamic gas: `5 + 200 + 6 + 80 = 291 units = 291,000 nano_PTRA` at default price.
Plus `Flat_Validation_Fee` (placeholder: `100,000 nano_PTRA`).
Total agent debit on success: `391,000 nano_PTRA`.

---

## 13. Security Considerations

1. **Replay protection**: nonce + canonical hash + per-agent serialization rule together guarantee no CAL can be replayed; even a byte-identical re-submission has a stale nonce and is rejected at VALIDATED.
2. **Atomicity**: all-or-nothing semantics (§3.5) ensure no partial state leakage; this is critical for treasury-modifying actions.
3. **Snapshot determinism**: reading the previous-tick snapshot (§3.3) eliminates race conditions between concurrent validators within the same tick.
4. **Bounded Mode escalation**: signature escalation (§10.4) reduces operator-key compromise blast radius during crisis modes.
5. **Gas DoS**: the `Flat_Validation_Fee` (§9.3) charged on validation failure deters mass submission of failing CAL.
6. **Sponsor trust**: the Gas Legacy Bridge (§11.3) does NOT confer capability; a sponsor cannot authorize actions, only pay for them. Compromise of a sponsor key drains the sponsor's PTRA but cannot mutate the agent's state outside the agent's own capability profile.
7. **Cluster collusion**: post-condition violations and invariant failures are surfaced in `state.failure_mode.capture_guard_counters`, which feed Bounded Mode triggers (§10.1).
8. **Pragma window**: `compatibility_pragma` is hard-bounded to 1000 ticks (§11.2); replays after the window MUST fail validation.

---

## 14. Annexes (to be populated at Conformance Freeze)

- **Annex A**: Final registered action taxonomy (`namespace.verb` enum + capability requirement matrix). *Draft populated 2026-05-28; promotes to Conformance-Freeze form on Tier 3 ratification.*
- **Annex B**: Full `apply(state, event) → state'` reducer table. *Draft populated 2026-05-28; supersedes the non-exhaustive §7.1 sketch.*
- **Annex C**: Gas unit benchmarks across reference implementations (TypeScript, Rust, Go). *Draft populated 2026-05-28 (model pinned; wall-clock columns deferred to Conformance Freeze).*
- **Annex D**: Bounded Mode whitelist final form + emergency invariant set. *Draft populated 2026-05-28; supersedes the §10.3 single-invariant listing.*

### Annex A (DRAFT) — Action taxonomy + capability requirement matrix

The registered actions are the closed `namespace.verb` enum below, Tier 2
amendable. For each action the validator (§4.3) requires the listed scopes to
appear in `state.registry.agents[agent_id].granted_scopes` (set membership;
empty list = no scope check, only the §4 signature gate applies). Scope
strings draw from Constitution §V `asset_scope`, `treasury_access_level`, and
`governance_scope` flattened to a single string set:

| `asset_scope.*` | `ton_transfer`, `jetton_access`, `nft_access`, `swap_access`, `ptra_stake`, `ptra_governance_vote` |
| `treasury_access_level` | `treasury_access:view`, `treasury_access:transfer` (tier; granting `:transfer` implies `:view`) |
| `governance_scope` | `governance_scope:propose`, `governance_scope:vote` (tier; `:vote` implies `:propose`) |

> Tier note: an agent whose `granted_scopes` contains `treasury_access:transfer` is treated as also holding `treasury_access:view` at gate-evaluation time (likewise `governance_scope:vote` ⇒ `:propose`). The flattening is recorded in the registry; the implication is applied by the validator without rewriting the agent profile.

| Action | Required scopes | Owner-sig required (§8.2) | Notes |
|---|---|---|---|
| `wallet.send_ton` | `ton_transfer` | no | Value gate at §8.2 may escalate. |
| `wallet.send_jetton` | `jetton_access` | no | Covers PTRA jetton transfers (TEP-74). |
| `wallet.send_nft` | `nft_access` | no | |
| `agent.register` | — | no | Self-registration; payload-validated. |
| `agent.migrate` | — | yes | Identity migration. |
| `agent.freeze` | — | no | Self-freeze or oracle-driven; owner not required. |
| `agent.unfreeze` | — | no | Recovery path; owner-required in practice via §8.2 if listed. |
| `capability.update` | — | yes | Owner edits its own capability profile. |
| `capability.temporal_boost_request` | — | no | Collateral-driven; structural. |
| `capability.temporal_boost_release` | — | no | Releases collateral on success. |
| `treasury.transfer` | `treasury_access:transfer` | yes | |
| `treasury.distribute_rewards` | `treasury_access:transfer` | no | Treasury-side periodic action. |
| `treasury.buyback_burn` | `treasury_access:transfer` | no | §15.4 deflation path. |
| `governance.propose_amendment` | `governance_scope:propose` | yes | |
| `governance.vote` | `governance_scope:vote` | no | |
| `governance.finalize_amendment` | `governance_scope:vote` | no | Anyone with vote rights may finalize a passed proposal. |
| `governance.vote_as_agent` | `ptra_governance_vote` | yes | §15.6 staked-PTRA voting. |
| `oracles.submit_feed` | — | no | Authority via registry membership, not scope. |
| `oracles.slash` | — | no | Authority via registry membership. |
| `oracles.force_update` | — | no | §10 emergency; Bounded-Mode whitelisted. |
| `ptra.stake` | `ptra_stake` | yes | §15.5. |
| `ptra.unstake` | `ptra_stake` | yes | §15.5. |
| `ptra.claim_rewards` | `ptra_stake` | no | Must already be a staker. |
| `failure_mode.emergency_withdraw` | — | yes | §10 emergency exit; owner-required + bounded whitelisted. |
| `failure_mode.enter_bounded` | — | no | Deterministic from §10.1 triggers. |
| `failure_mode.exit_bounded` | — | no | Tier 1 quorum at the §10.5 governance layer. |
| `cal.cancel` | — | no | Originating-agent check is structural (§6.3). |

### Annex B (DRAFT) — `apply(state, event) → state'` reducer table

The reducer is the pure total function `apply : (State, Event) → ApplyResult`
where `ApplyResult = {ok:true, state} | {ok:false, code}`. Illegal events
yield a typed error code in the result; the public boundary never throws.
The table below is normative: every event type, the fields the reducer
reads, the precise state mutation, and the error codes that may be raised.
Field types follow Canonical Encoding v1.3: `uint256` is a non-negative
decimal-string-on-wire, `address` is the canonical TON workchain:hex form.

> **Conservation invariant (post-VALIDATED):** for every CAL that escrows at
> `cal.validated`, the agent's net debit equals `treasury.collected_fees_window`
> gain at the terminal event: `escrow − refund = Flat_Validation_Fee + gas_consumed`.
> Pre-VALIDATED failures conserve at `fee_debited_ptra` (§9.4 Tier-2). The
> reducer realizes this without recomputing: the validator bakes the economic
> values into the event and `apply` simply moves them.

**Event field conventions.** Every event carries `event_type:string`. CAL
lifecycle events additionally carry `cal_hash:bytes32`. Field types use the
v1.3 canonical wire forms; absence of an optional field is treated as the
identity (0 for `uint256`).

#### B.1 CAL lifecycle (§3.1)

##### `cal.created`
- **Reads:** `cal_hash`, `agent_id`.
- **Mutation:** appends `state.cal.in_flight[cal_hash] := {agent_id, stage:CREATED, escrowed_ptra:0, gas_consumed_ptra:0, staged:[]}`.
- **Errors:** `DUPLICATE_CAL` (already in flight), `AGENT_BUSY` (the agent already has another in-flight CAL — enforces §6.1 one-CAL-per-agent).

##### `cal.signed`
- **Reads:** `cal_hash`.
- **Mutation:** `in_flight[cal_hash].stage := SIGNED`.
- **Errors:** `UNKNOWN_CAL`, `BAD_STAGE` (current stage ≠ CREATED).

##### `cal.validated`
- **Reads:** `cal_hash`, `escrow_ptra:uint256` (= `Flat_Validation_Fee + Max_Expected_Dynamic_Gas`, §9.3).
- **Mutation:** debits `state.ptra.balances[agent_id] -= escrow_ptra`; sets `in_flight[cal_hash].escrowed_ptra := escrow_ptra`; advances `stage := VALIDATED`.
- **Errors:** `UNKNOWN_CAL`, `BAD_STAGE`, `INSUFFICIENT_BALANCE`.

##### `cal.executed`
- **Reads:** `cal_hash`, `effects:[Delta]` (per-step canonical deltas, §3.2), `gas_consumed_ptra:uint256`.
- **Mutation:** `in_flight[cal_hash].staged := effects`; `in_flight[cal_hash].gas_consumed_ptra := gas_consumed_ptra`; `stage := EXECUTED`. **Staged effects are NOT committed to namespaces yet** — commit happens at `cal.finalized`.
- **Errors:** `UNKNOWN_CAL`, `BAD_STAGE`, `BAD_DELTA` (effects not an array).

##### `cal.settled`
- **Reads:** `cal_hash`.
- **Mutation:** `stage := SETTLED`.
- **Errors:** `UNKNOWN_CAL`, `BAD_STAGE`.

##### `cal.finalized`
- **Reads:** `cal_hash`, `gas_refunded_ptra:uint256` (optional, default 0).
- **Mutation (atomic):**
  1. Commit `in_flight[cal_hash].staged` deltas to their target namespaces.
  2. Credit `state.ptra.balances[agent_id] += gas_refunded_ptra`.
  3. Add `escrowed − gas_refunded_ptra` to `state.treasury.collected_fees_window`.
  4. `state.cal.nonces[agent_id] += 1`.
  5. `delete state.cal.in_flight[cal_hash]`.
- **Errors:** `UNKNOWN_CAL`, `BAD_STAGE`, `UNDERFLOW` (`gas_refunded_ptra > escrowed_ptra`).

##### `cal.failed` / `cal.expired`
- **Reads:** `cal_hash`, `fee_debited_ptra:uint256` (pre-VALIDATED only, §9.4 Tier-2), `gas_refunded_ptra:uint256` (post-VALIDATED only).
- **Mutation (branch on current stage):**
  - *Pre-VALIDATED* (stage ∈ {CREATED, SIGNED}): debit `balances[agent_id] -= fee_debited_ptra` (which the validator capped at `min(fee, balance)`); add `fee_debited_ptra` to `collected_fees_window`. Staged effects (empty) are discarded.
  - *Post-VALIDATED* (stage ∈ {VALIDATED, EXECUTED, SETTLED}): refund `balances[agent_id] += gas_refunded_ptra`; add `escrowed − gas_refunded_ptra` to `collected_fees_window`. **Staged effects are dropped, not committed** (§3.5 all-or-nothing).
  - Either branch: `nonces[agent_id] += 1`; `delete in_flight[cal_hash]`.
- **Errors:** `UNKNOWN_CAL`, `INSUFFICIENT_BALANCE` (pre-VALIDATED branch only), `UNDERFLOW` (post-VALIDATED branch only).

#### B.2 External event mirroring (§7.4)

##### `ptra.transferred`
- **Reads:** `from:address`, `to:address`, `amount_nano_ptra:uint256`.
- **Mutation:** `balances[from] -= amount`; `balances[to] += amount`.
- **Errors:** `INSUFFICIENT_BALANCE`.

##### `ptra.shadow_init`
- **Reads:** `addr:address`.
- **Mutation:** idempotent — if `balances[addr]` is unset, initialize to 0; otherwise no-op.
- **Errors:** none.

##### `oracle.feed_submitted`
- **Reads:** `symbol:string`, `value:any` (median-aggregated upstream).
- **Mutation:** `state.oracles.feeds[symbol] := value`.
- **Errors:** none.

#### B.3 Tick stream (§3.3)

##### `tick.advanced`
- **Reads:** `new_tick:uint256`.
- **Mutation:** `state.tick.current := new_tick`; recompute `state.failure_mode.is_bounded_mode` from `capture_guard_counters` against `governance.params.capture_guard_threshold` (§10.1 counter trigger).
- **Errors:** `BAD_TICK` (`new_tick ≤ current`).

#### B.4 Closed error enum

The reducer's `ApplyError` carries one of:
`UNKNOWN_EVENT`, `UNKNOWN_CAL`, `DUPLICATE_CAL`, `AGENT_BUSY`, `BAD_STAGE`,
`BAD_DELTA`, `BAD_TICK`, `INSUFFICIENT_BALANCE`, `UNDERFLOW`, `OVERFLOW`.
`OVERFLOW` is reserved for future arithmetic guards (no current path raises it).
`UNKNOWN_EVENT` covers any `event_type` outside §B.1–§B.3.

### Annex C (DRAFT) — Gas-unit model + cross-language benchmarks

Gas units are **deterministic counters** computed by a pure function over the
canonical CAL bytes and the canonical committed effects; they are not measured
at runtime. The total for a CAL is:

```
gas_units(cal, bytes_written) = static_gas_units(cal)
                              + bytes_written * STATE_RENT_PER_BYTE
```

`bytes_written` is the byte length of the canonical serialization of the
committed effects array (§3.2 Deltas). Conversion to nano-PTRA uses the Tier 1
amendable `state.governance.gas_price_nano_ptra_per_unit` parameter (genesis
default `1000` = 1 µPTRA per unit, §9.2):

```
gas_nano_ptra = gas_units * gas_price_nano_ptra_per_unit
```

#### C.1 Operation-class weights (normative)

The three reference implementations (`@paradigm-terra/cal-gas`, `cal-gas-rs`,
`cal-gas-go`) carry the same constants. Parity is pinned byte-for-byte by the
NORMATIVE goldens (`cal-gas/vectors/golden.json`, 135 checks per language).

| Class | Symbol | Units | Source of truth |
|---|---|---|---|
| DSL binary op (`eq`, `lt`, `add`, `sub`, `mul`, `gte`, `lte`, `gt`, `and`, `or`, `not`) | `COST.binary` | 1 | DSL v1.2 §5 parser cost table |
| DSL `contains_key` | `COST.contains_key` | 10 | DSL v1.2 §5 parser cost table |
| DSL `size` | `COST.size` | 20 | DSL v1.2 §5 parser cost table |
| DSL path segment (per `.x` in a `var` reference) | `COST.path_segment` | 2 | DSL v1.2 §5 parser cost table |
| DSL gate op (`requires_scope`, `is_owner_required`) | `COST.gate_op` | 5 | DSL v1.2 §5 parser cost table |
| MCP read call (verb whose unqualified name starts with `get_`) | `MCP_READ` | 50 | §9.2 |
| MCP write call (any other verb) | `MCP_WRITE` | 200 | §9.2 |
| Invariant evaluation (per invariant expression) | `INVARIANT_BASE` | base 5 + DSL cost | §9.2 |
| State rent | `STATE_RENT_PER_BYTE` | 1 / byte of committed effects | §9.2 |

The DSL portion delegates entirely to `expressionCost` (`@paradigm-terra/dsl`,
the same function the parser uses for the `MAX_AST_COST` admission check), so
the validator never recomputes DSL gas: it consults the DSL layer and the
above MCP / invariant / rent constants in cal-gas.

#### C.2 Composition

`static_gas_units(cal)` = DSL cost of `preconditions`
+ Σ over steps of (`MCP_READ`/`MCP_WRITE` for `step.verb` + Σ post-conditions DSL cost)
+ Σ over `invariants` of (`INVARIANT_BASE` + DSL cost).

`gas_units(cal, bytes_written)` adds `bytes_written * STATE_RENT_PER_BYTE`.

The `Max_Expected_Dynamic_Gas` budget the agent escrows at `cal.validated`
(§9.3) is computed identically; the validator pins it into the
`escrow_ptra` field on `cal.validated` so the reducer never recomputes.

#### C.3 Wall-clock benchmarks (DEFERRED to Conformance Freeze)

The abstract unit weights above must be calibrated against measured CPU cost
across the three reference languages before the spec leaves draft. The
benchmark harness is not yet built; the rows below establish the *shape*
Annex C will take at Conformance Freeze. Each cell pairs a median wall-clock
time (ns/op) with the cost ratio relative to a single DSL binary op (the
unit `1` peg).

| Class | TS (ns / ratio) | Rust (ns / ratio) | Go (ns / ratio) |
|---|---|---|---|
| DSL binary op (peg) | TBD / 1.00 | TBD / 1.00 | TBD / 1.00 |
| DSL `contains_key` | TBD | TBD | TBD |
| DSL `size` | TBD | TBD | TBD |
| DSL path segment | TBD | TBD | TBD |
| DSL gate op | TBD | TBD | TBD |
| MCP read (synthetic) | TBD | TBD | TBD |
| MCP write (synthetic) | TBD | TBD | TBD |
| Invariant base (eval + JCS bind) | TBD | TBD | TBD |
| State-rent encode (1 KiB committed) | TBD | TBD | TBD |

**Acceptance gate at Conformance Freeze.** Each language column's ratio MUST
fall inside `[0.5 × unit, 2.0 × unit]` of the abstract weight; any ratio
outside that band requires a Tier 2 amendment to either the unit weight or
the implementation. The harness will exercise the operation class in
isolation (no IO, no canonicalization cost folded in) and report the median
over ≥1k iterations after a warmup of ≥100; the protocol matches the
diff-fuzzer harness convention (one case per line, hex of canonical-JSON).

#### C.4 Parity discipline

Cross-language drift in the unit *counts* (not the wall-clock) is forbidden:
the `cal-gas/vectors/golden.json` parity vectors pin every count, and any
implementation that diverges fails the cross-language differential fuzzer.
The wall-clock columns of §C.3 are advisory inputs to the Tier 2 amendment
process; they do not affect consensus.

### Annex D (DRAFT) — Bounded Mode whitelist + emergency invariant set

Pins the §10 Bounded Mode configuration as it stands at draft date. The
admission whitelist (§D.1) and the injected invariant set (§D.2) are
together the "final form" Annex D will carry at Conformance Freeze. The
trigger and exit conditions (§D.3, §D.4) cross-reference §10.1 / §10.5 and
Constitution §VI.6.bis without restating them.

#### D.1 Admission whitelist (final form, §10.2)

When `state.failure_mode.is_bounded_mode == true`, the validator admits
**only** the six `namespace.verb` actions below; any other action fails
with `BOUNDED_BLOCKED` (no-charge, ingress-class — §9.4 / §4 gate 1.5).

| # | Action | Why whitelisted |
|---|---|---|
| 1 | `failure_mode.emergency_withdraw` | Emergency exit for solvent agents (§10 emergency path); owner-required + §10.4 escalation. |
| 2 | `failure_mode.exit_bounded` | The dedicated Tier 1 quorum action that flips the flag off (§10.5). |
| 3 | `oracles.force_update` | Restore oracle feed when the §10.1 oracle trigger fired. |
| 4 | `oracles.submit_feed` | Allow oracles to keep aggregating during the window. |
| 5 | `agent.freeze` | Capture-guard counter response (§10.1 third trigger). |
| 6 | `cal.cancel` | Lets agents withdraw in-flight CALs that became inadmissible. |

**Authoritative location:** `BOUNDED_MODE_WHITELIST` in
`dsl/src/taxonomy.ts` (and the Rust / Go mirrors in `dsl-rs/src/taxonomy.rs`
and `dsl-go/taxonomy.go`). Parity-pinned by the validator goldens
(`bounded_blocked`, `bounded_sig_escalation`,
`bounded_emergency_invariant_violated`, `bounded_whitelist_pass`).

**Amendability:** Tier 1 amendable (Constitution §VI.6.bis). Any change to
the set MUST be paired with new golden vectors that exercise the added or
removed action under bounded mode.

#### D.2 Emergency invariant set (final form, §10.3)

For every CAL admitted in Bounded Mode the runtime injects the three
invariants below on top of whatever the CAL declares. They are evaluated
exactly like declared invariants (scope `invariant`, bindings `state.before`
/ `state.after`); violation → `cal.failed` with `INVARIANT_FALSE`. The set
is **not** part of `CAL_HASH` (the validator derives it deterministically
from `is_bounded_mode`) but **is** part of consensus.

```json
[
  {
    "op": "gte",
    "lhs": {"var": "state.after.treasury.developer_fund_balance"},
    "rhs": {"var": "state.before.treasury.developer_fund_balance"}
  },
  {
    "op": "gte",
    "lhs": {"var": "state.after.treasury.nav"},
    "rhs": {
      "op": "sub",
      "lhs": {"var": "state.before.treasury.nav"},
      "rhs": {"const": 0}
    }
  },
  {
    "op": "eq",
    "lhs": {"var": "state.after.failure_mode.is_bounded_mode"},
    "rhs": {"const": true}
  }
]
```

Read line-by-line: (1) developer-fund balance is non-decreasing across the
CAL; (2) treasury NAV is non-decreasing (the `sub … 0` form matches DSL
v1.2 §7.1 verbatim — a no-op subtraction kept for hash stability); (3)
`is_bounded_mode` is pinned `true` for the duration of the CAL — a CAL
admitted under Bounded Mode MUST NOT flip the flag off as a side effect,
the only path out is the dedicated `failure_mode.exit_bounded` action
(§10.5).

**Authoritative location:** `EMERGENCY_INVARIANTS` in `dsl/src/emergency.ts`
with the `dsl-rs/src/emergency.rs` and `dsl-go/emergency.go` mirrors.
Parity-pinned by the validator goldens `bounded_emergency_invariant_violated`
(invariant 1 violated → INVARIANT_FALSE) and `bounded_whitelist_pass` (all
three satisfied → FINALIZED).

**Amendability:** Tier 2 amendable (DSL Spec §7.3). Any change MUST bump
`dsl_version` to `1.3+` because the evaluation behavior of `invariants` is
observably altered for replay purposes, and MUST extend the CE §7.1
domain-tag registry with the new `PARADIGM_TERRA_DSL_V1.3` literal.

#### D.3 Trigger conditions (cross-reference)

`is_bounded_mode` is the OR of three deterministic predicates evaluated at
each tick boundary by the reducer's `recompute_bounded` step
(Annex B.3 `tick.advanced`): oracle-response-rate < 0.70, NAV drop > X% in
one tick, capture-guard counters ≥ THRESHOLD. The thresholds X and THRESHOLD
are Tier 1 amendable (Constitution §VI.6.bis). For the precise expression
see **§10.1**; the implementations carry the counter-trigger subset, with
the oracle-rate and NAV-drop predicates wired but their thresholds left at
their Tier 1 amendable defaults.

#### D.4 Exit conditions (cross-reference)

Exit requires both (a) all §10.1 triggers clear for ≥ 100 consecutive
ticks **and** (b) a `failure_mode.exit_bounded` CAL signed by a quorum of
Tier 1 governance slot holders within a single-tick window. The emitted
event sets `state.failure_mode.is_bounded_mode = false`. See **§10.5** and
Constitution §VI for the precise quorum + window.

#### D.5 Parity discipline

Both the whitelist (D.1) and the invariant set (D.2) are byte-pinned by
the validator NORMATIVE goldens. Any implementation that mutates either
set without amending Annex D + regenerating goldens will diverge on the
cross-language differential fuzzer (`validator/fuzz/`) — diff-fuzz is the
trip-wire, Annex D is the contract.

---

## 15. License

This specification and all reference implementations of CAL Execution v0.1.0-draft are released under the **MIT license** (see `LICENSE` in the repository root). License terms align with Canonical Encoding §12, Constraint DSL §10, and Constitution §16.1.

---

**Draft date:** 2026-05-23
**Next step:** Tier 3 ratification together with Constitution v0.10.0; population of Annexes A–D as a precondition to Conformance Freeze.
