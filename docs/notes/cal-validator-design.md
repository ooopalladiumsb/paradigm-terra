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
  reasonDetail:  string,
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

Full Constitution §V scope matrix / CAL Annex A, real Ed25519 verification, the
MCP schema-hash check (§4.4), and Bounded-Mode whitelisting (§10) are **deferred**
— same posture as every prior phase (crypto/external pinned later).

## 6. Gas & the reducer-accounting gap

Gas comes entirely from [[../../cal-gas]]: `flatValidationFee`,
`maxExpectedDynamicGas`, `gasUnits`, `toNano`, `canValidate`, `settle`. The
result's `bill` is the **intended** §9.4 settlement.

The emitted **events** realize only what the *frozen* reducer books:

- The reducer debits the fee at `cal.validated` and reads `gas_consumed_ptra`
  from the in-flight record set at `cal.executed`.
- Failures **before** `cal.validated` (gates 1–7) therefore move **no PTRA** via
  the reducer, and failures before `cal.executed` (gates 8–11) charge the fee
  only — even though §9.4 says `PRECOND_FALSE`/`CAPABILITY_DENIED` retain the fee
  and `OUT_OF_GAS` retains fee + consumed gas.

This divergence is the item flagged "deferred to the validator phase" in the gas
note. The reducer is NORMATIVE/frozen, so we do **not** change it now; instead
the validator surfaces both views (`events` = reducer-realizable, `bill` =
intended) and the golden pins both, making the gap explicit and testable. The
§9.3 escrow gate (gate 7) has no dedicated `reason_code` in §3.5; it is reported
as `OUT_OF_GAS` provisionally, to be reconciled at Conformance Freeze.

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
                 reason_detail, gas_consumed_ptra, ton_ingress_fee_paid }
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
`EXPIRED_PRE` / `EXPIRED_POST`. Generated by the TS reference; promoted
PRE-NORMATIVE → NORMATIVE once `validator-rs` + `validator-go` reproduce every
value byte-for-byte.

## 9. Open decisions (defaults chosen)

1. **Execution model** — validate a provided trace (no embedded MCP executor);
   step effects + per-step ok/result are inputs.
2. **post_condition / invariant binding** — all evaluate against the single
   `(stateBefore, stateAfter)` pair in the trace; per-step intermediate states
   are collapsed to the final after-state (revisit if a CAL needs staged reads).
3. **Escrow-gate reason** — `OUT_OF_GAS` (provisional; §3.5 lacks an
   insufficient-balance code).
