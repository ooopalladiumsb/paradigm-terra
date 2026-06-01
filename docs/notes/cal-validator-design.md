# CAL Validator — design note (CAL Execution Spec v0.1.0-draft §3–§9)

## 1. Purpose & position

The validator is the last CAL piece. It wires the four frozen layers — DSL
evaluation ([[../../dsl]]), gas ([[../../cal-gas]]), and the snapshot/lifecycle
model — into one **pure function** that drives a SIGNED CAL through the §3.1
state machine and emits the self-describing stage events the frozen reducer
(`cal-reducer`) consumes.

It **evaluates**; it does not **execute**. Per §4.1 ("validators do not execute
steps"), the external, non-deterministic MCP step effects arrive as an
**execution trace**. Everything the validator does is decidable from
`(cal, snapshot, trace)` alone, so two conforming implementations reach the same
verdict and emit byte-identical events.

## 2. Signature

```
validate(cal, calHashHex, snapshot, trace) -> ValidationResult

ValidationResult = {
  events:        Event[],          // ordered, reducer-ready stage events
  terminalStage: FINALIZED | FAILED | EXPIRED,
  reasonCode:    ReasonCode | null,   // non-null only for FAILED
  reasonDetail:  string,           // off-chain diagnostic ONLY — never an event field (§7)
  bill:          GasBill,          // intended §9.4 settlement (from cal-gas)
}
```

`cal_hash` is computed once at CREATED ingress and carried in; the validator does
not re-hash (keeps it independent of the `cal` skeleton/hashing layer — deps are
**dsl + cal-gas** only). Inputs:

- `cal` — schema-valid CAL (§2.1): `action, agent_id, nonce, expiration_tick,
  preconditions, steps[], invariants[], signatures`, optional `gas_limit_ptra`.
- `snapshot` — materialized state at `tick.current − 1` (§3.3). The **only** state
  preconditions, capability and gas read.
- `trace` — `{ currentTick, steps:[{ok, effects:Delta[], errorDetail?}],
  stateBefore, stateAfter, ownerSigPresent }`. The deterministic record of the
  external execution: per-step success + the deltas it produced, and the
  before/after states bound to `state.before.*` / `state.after.*`.

## 3. Pipeline (gate order — §3.1, §4)

Stops at the first gate that fails. `[evt]` = event appended.

| # | Gate | On failure |
|---|------|------------|
| 1 | action registered (§2.3) | FAILED `UNKNOWN_ACTION` |
| 2 | `currentTick ≤ expiration_tick` | `[cal.expired]`, EXPIRED (bill `EXPIRED_PRE` — no PTRA) |
| 3 | `nonce == nonces[agent]+1` (§6.2) | FAILED `NONCE_MISMATCH` |
| 4 | owner-sig present if `action ∈ OWNER_REQUIRED_ACTIONS` (§8.2) | FAILED `CAPABILITY_DENIED` |
| 5 | agent granted every required scope (§4.3) | FAILED `CAPABILITY_DENIED` |
| 6 | preconditions evaluate TRUE (snapshot) | FAILED `PRECOND_FALSE` / `PRECOND_ERROR` |
| 7 | `canValidate` — balance ≥ escrow (§9.3) | FAILED `OUT_OF_GAS` (provisional, see §6) |
| — | **`[cal.validated]`** (fee debited) | — |
| 8 | re-check expiration (§3.4) | `[cal.expired]`, EXPIRED (bill `EXPIRED_POST` — fee retained) |
| 9 | each step `trace.steps[i].ok` | FAILED `STEP_ERROR` |
| 10 | each step's post_conditions TRUE | FAILED `POSTCOND_FALSE` / `STEP_ERROR` |
| 11 | `rawGas ≤ maxGas` else overrun (§9.3) | FAILED `OUT_OF_GAS` |
| — | **`[cal.executed]`** (effects staged, gas recorded) | — |
| 12 | re-check expiration | `[cal.expired]`, EXPIRED |
| 13 | invariants TRUE over before/after | FAILED `INVARIANT_FALSE` |
| — | **`[cal.settled]`**, then **`[cal.finalized]`** (refund) | — |

`cal.created` / `cal.signed` are ingress events (§9.1, TON-paid); the snapshot
already holds the CAL in `in_flight` at SIGNED, so the validator starts at
SIGNED→VALIDATED and never emits them.

## 4. Reason-code mapping (closed enum §3.5)

DSL `run` returns `EVALUATION_TRUE | EVALUATION_FALSE | ERROR | VALIDATION_ERROR
| PARSE_ERROR`. Mapping per scope:

| Scope | TRUE | FALSE | ERROR / VALIDATION / PARSE |
|-------|------|-------|----------------------------|
| precondition | pass | `PRECOND_FALSE` | `PRECOND_ERROR` |
| post_condition | pass | `POSTCOND_FALSE` | `STEP_ERROR` |
| invariant | pass | `INVARIANT_FALSE` | `INVARIANT_FALSE` (non-satisfied) |

(The §3.5 enum has no `POSTCOND_ERROR` / `INVARIANT_ERROR`; embedded expressions
are already parse-validated by the schema layer, so only runtime `ERROR`
— `MISSING_VAR`, `DIV_BY_ZERO`, `OVERFLOW`, `TYPE_MISMATCH` — is reachable here.)

## 5. Capability check (v0.1.0 placeholder)

Two deterministic checks, both reusing the DSL taxonomy as the single source of
truth:

1. **Owner-required** — `isOwnerRequired(action)` (the §8.2 enum) ⇒
   `trace.ownerSigPresent` must hold.
2. **Scope grant** — required scopes = `REQUIRES_SCOPE_TABLE[action]`; the agent's
   `snapshot.registry.agents[agent_id].granted_scopes` must contain every one.
   Actions with no table entry require no scope.

Full Constitution §V scope matrix / CAL Annex A, the MCP schema-hash check (§4.4),
and Bounded-Mode whitelisting (§10) are **deferred** — same posture as every prior
phase (crypto/external pinned later).

**Real Ed25519 verification — LANDED (2026-06-01).** The node-side verifier producing the
trace's `*SigPresent` booleans now does real curve arithmetic: `operator_sig` = raw Ed25519
over `canonical_bytes(cal_without_signatures)` (agent runtime key); `owner_sig` = Contract A
commit (`TC_V2_SIGNDATA_VERIFY_V1`, TON Connect signData/binary, D1). It runs before the trace
is built; `validate()` stays pure over the booleans. The §10.2 operator-pubkey byte-match
invariant is unchanged. Impl: `validator/src/owner-sig.ts`, `cal-validator-go/owner_sig.go`;
NORMATIVE vectors `spec/vectors/tc_v2_sig_verify_v1/`; contract `docs/spec/cal-co-signature-envelope.md`.

## 6. Gas & the reducer-accounting reconciliation

Gas comes entirely from [[../../cal-gas]]: `flatValidationFee`,
`maxExpectedDynamicGas`, `gasUnits`, `toNano`, `canValidate`, `settle`. The
result's `bill` is the **intended** §9.4 settlement.

### 6.1 Pre-VALIDATED fee — CLOSED (§9.4 Tier-2 revision, 2026-05-26)

The original gap: failures before `cal.validated` (gates 1–7) emit no
`cal.validated`, so the frozen reducer escrowed nothing and moved **no PTRA**,
even though §9.4 charges the flat fee on `PRECOND_FALSE`/`CAPABILITY_DENIED`.

Closed by a Tier-2 reducer revision plus a validator change:

- The pre-VALIDATED `cal.failed` now carries `fee_debited_ptra`, and the reducer
  debits it from the agent and retains it at the terminal event (it was never
  escrowed). See [[cal-reducer-design]] §4/§5.
- The charge is `min(fee, balance)` — the §9.3 escrow gate runs *after* the
  precond/capability gates, so the full fee is not yet guaranteed; the validator
  bakes the concrete (capped) amount into the event, so the reducer never
  recomputes or underflows. `cal-gas.settle` mirrors this in `FAILED_PRECOND`.
- **Spec-literal scope (decision 2026-05-26):** only `PRECOND_FALSE` and
  `CAPABILITY_DENIED` charge. `UNKNOWN_ACTION`/`NONCE_MISMATCH` (malformed/replay,
  §9.1 ingress-class), `PRECOND_ERROR` (a precondition that errored, not merely
  returned false), and the §9.3 escrow shortfall (`OUT_OF_GAS`, agent cannot
  cover escrow) retain **nothing** — modelled by the new `FAILED_NO_CHARGE`
  outcome. For these, `events == bill` exactly (both zero).

Net: for every **pre-VALIDATED** outcome, the events the reducer realizes now
equal the intended `bill`.

### 6.2 Post-VALIDATED consumed gas — CLOSED (2026-05-26)

`cal.executed` (which records `gas_consumed_ptra` in the in-flight record) is
emitted only *after* the step/post-condition/gas-overrun gates (9–11). So a
failure at those gates emitted a `cal.failed` whose `gas_consumed_ptra` the
reducer read from the in-flight record — still `0` because `cal.executed` never
fired — while the `bill` (`FAILED_EXEC`) includes the consumed dynamic gas. The
residue: the treasury realized the fee only, not the consumed gas.

Closed by a reducer revision: for a stage-`VALIDATED` failure (i.e. before
`cal.executed`), the reducer reads `gas_consumed_ptra` from the **event** — the
validator already bakes `bill.dynamicGasConsumed` into the `cal.failed` event
(self-describing, same posture as the §9.4 spam charge). `INVARIANT_FALSE` (gate
13, after `cal.executed`) and the happy `FINALIZED` path are unchanged (they read
the recorded value); `EXPIRED_POST` carries `0` either way. Net: for **every**
`FAILED_EXEC` outcome the treasury now realizes `fee + consumed gas`, matching the
bill. Pinned by `cal-reducer` golden `postvalidated_exec_fail_consumed_gas` and
the round-trip test, reproduced byte-for-byte by Rust + Go.

The §9.3 escrow gate (gate 7) now reports a dedicated `INSUFFICIENT_ESCROW`
reason code (§3.5), distinct from the post-VALIDATED `OUT_OF_GAS` dynamic-gas
overrun at gate 11 — the two were previously conflated under `OUT_OF_GAS`.

## 7. Events emitted (reducer-ready fields)

Self-describing, carry the economic values; field names from §5/§7.1. Extra
fields are ignored by the reducer.

```
cal.validated  { cal_hash, agent_id, nonce, fee_debited_ptra }
cal.executed   { cal_hash, effects:[Delta], gas_consumed_ptra }
cal.settled    { cal_hash }
cal.finalized  { cal_hash, agent_id, nonce, tick_finalized, gas_consumed_ptra,
                 gas_refunded_ptra, steps_applied, invariants_checked }
cal.failed     { cal_hash, agent_id, nonce, tick_failed, reason_code,
                 fee_debited_ptra?, gas_consumed_ptra, ton_ingress_fee_paid }
                 // fee_debited_ptra present (§9.4 Tier-2) on a PRE-VALIDATED failure —
                 // the spam charge min(fee, balance) the reducer debits; omitted post-VALIDATED.
                 // reason_detail is deliberately NOT an event field: a node folds every event
                 // into the CE §6.3 global Merkle root, so a free-form, port-divergent string
                 // must never enter one. It lives only on ValidationResult (§2) for off-chain logs.
cal.expired    { cal_hash, agent_id, nonce, tick_expired, gas_consumed_ptra,
                 ton_ingress_fee_paid }
```

The full §5.1 receipt enrichment (`state_root_before`/`after`) needs the reducer
to materialize state and is layered by a node that runs both; it is left out of
the validator's portable core (keeps `validator-rs`/`-go` free of a reducer dep).

## 8. Module layout & golden plan

```
validator/      (TypeScript reference, @paradigm-terra/cal-validator; deps: dsl + cal-gas)
  src/ trace.ts (ExecutionTrace / StepResult / Json)
       validate.ts (the pipeline)
       index.ts
validator-rs/   (Rust parity — reuses dsl-rs + cal-gas-rs; canonical-rs transitively)
validator-go/   (Go parity — reuses dsl-go + cal-gas-go)
```

Golden vectors pin, per scenario: the ordered list of emitted `event_type`s, the
terminal stage, `reason_code` (or null), the economic event fields
(`fee_debited_ptra`, `gas_consumed_ptra`, `gas_refunded_ptra`), and the full
`bill`. Scenarios cover the happy FINALIZED path and each reachable reason code
(`PRECOND_FALSE`, `PRECOND_ERROR`, `NONCE_MISMATCH`, `CAPABILITY_DENIED` ×2,
`POSTCOND_FALSE`, `INVARIANT_FALSE`, `STEP_ERROR`, `OUT_OF_GAS`) plus
`EXPIRED_PRE`. Generated by the TS reference, reproduced byte-for-byte by
`validator-rs` + `validator-go` (120 checks each), promoted PRE-NORMATIVE →
NORMATIVE on 2026-05-25. (`EXPIRED_POST` is unreachable in the single-call model
— the tick is constant across gates 2/8/12 — so the post-VALIDATED expiration
re-checks are defensive only, exercised under multi-tick orchestration.)

## 9. Open decisions (defaults chosen)

1. **Execution model** — validate a provided trace (no embedded MCP executor);
   step effects + per-step ok/result are inputs.
2. **post_condition / invariant binding** — all evaluate against the single
   `(stateBefore, stateAfter)` pair in the trace; per-step intermediate states
   are collapsed to the final after-state (revisit if a CAL needs staged reads).
3. **Escrow-gate reason** — `INSUFFICIENT_ESCROW` (CLOSED 2026-05-26; the §3.5
   enum now carries the dedicated code, distinct from `OUT_OF_GAS`).

## 10. W5 ↔ CAL isomorphism (normative)

Wallet V5 `ContractState` is the canonical on-chain projection of CAL
authorization state. The correspondence is **structural**, not analogical, and
the validator SHALL enforce its key invariant byte-for-byte.

### 10.1. Field mapping

| Wallet V5 (TL-B `ContractState`)           | CAL (`SIGNED` payload)                              |
|--------------------------------------------|-----------------------------------------------------|
| `wallet_id : ## 32`                        | `agent_id`                                          |
| external body `valid_until : ## 32`        | `expiration_tick`                                   |
| `seqno : ## 32`, body `msg_seqno : ## 32`  | `nonce`                                             |
| `public_key : ## 256`                      | `operator_pubkey`                                   |
| `is_signature_allowed : ## 1`              | root-signature enable bit                           |
| `extensions_dict : HashmapE 256 int1`      | Bounded Mode action whitelist (CAL Spec §10.2)      |

### 10.2. Operator key invariant (MUST)

```
validator.operator_pubkey
  MUST byte-match
Wallet V5 ContractState.public_key
  of the agent's deployed agentic-wallet SBT (Constitution §XI).
```

- **Encoding:** raw 32-byte Ed25519 public key. User-friendly (base64/bouncable)
  encodings are non-normative and MUST NOT appear in any field hashed under
  `CAL_HASH` or `RECEIPT_HASH`.
- **Verification chain:** the validator's configured `operator_pubkey` for
  `agent_id` is byte-equal to `state.registry.agents[agent_id].operator_pubkey`,
  which itself is byte-equal to the on-chain `ContractState.public_key`.
- **Rotation:** the `agentic_rotate_operator_key` flow (@ton/mcp, Constitution
  §XI) MUST update on-chain `ContractState.public_key` and the registry mirror
  in the same CAL. The validator only enforces equality at validation time;
  preventing split-brain rotation is the orchestrator's responsibility.

### 10.3. Bounded Mode as extension-gated execution

```
CAL Bounded Mode (CAL Spec §10) SHALL be interpreted as the off-chain analogue
of Wallet V5 extension-gated execution with is_signature_allowed = 0.
```

In W5, `is_signature_allowed = 0` rejects raw signed externals; the only
admissible path is an `internal_extension` from a pre-registered address, i.e.
a closed governance-managed whitelist. Bounded Mode realises the same constraint
off-chain: only `BOUNDED_MODE_WHITELIST` actions are admissible (§10.2), every
admitted action is escalated to require `owner_sig` (§10.4), and emergency
invariants are runtime-injected (§10.3). The `extensions_dict` and the bounded
whitelist are the same object viewed from two sides.

### 10.4. Future work (non-normative)

`canonical_to_cell(state)` MAY be introduced for TVM-native anchoring of
`STATE_ROOT` once on-chain Registry contracts exist. Until that roadmap is real,
the JSON canonical encoding (Canonical Encoding v1.3 §4-§6) remains the single
normative form for CAL-side hashing — BoC parity is deliberately out of scope.
