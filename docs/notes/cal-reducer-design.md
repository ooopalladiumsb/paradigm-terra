# CAL Reducer Phase Design — `apply(State, Event) → State`

**Status:** Design note (not normative). Targets CAL Execution Spec v0.1.0-draft §7.1
(the future Annex B). **Date:** 2026-05-25.
**Goal:** Define the deterministic event reducer that folds the Event Log into protocol
State, layered on the frozen CAL skeleton + DSL + canonical layers, **without changing
any committed hash**.

---

## 1. Where the reducer sits — three roles, one trusted log

Event sourcing splits the protocol into three roles:

```
 VALIDATOR (event producer)      REDUCER (this phase)        STATE ROOT (built)
 reads snapshot, evaluates       pure total fold over the    Merkle over the 8
 preconditions/invariants (DSL), trusted, ordered Event Log: namespaces (§7.3,
 capability, gas; OBSERVES step  apply(State, Event)→State.  canonical layer).
 effects → EMITS the next event  Moves values per event
 with all values baked in.       fields. No eval, no pricing.
```

**The reducer never re-derives anything.** Preconditions are evaluated by the validator;
gas is priced by the gas phase; MCP/step side effects are *observed* by the validator and
**recorded into the event as concrete state deltas**. The reducer replays those deltas and
moves economic values that the event already carries. This is what makes `apply`
deterministic across TS/Rust/Go even though execution touches non-deterministic externals
(MCP, TON) — the non-determinism is captured into the log, never recomputed.

**Self-describing events** are therefore the central design choice (see §4): every event
carries the exact effect it has on State.

---

## 2. Scope boundary

| In (reducer phase) | Deferred / other phases |
|---------------------|--------------------------|
| State model (8 namespaces) + genesis | Validator decision logic (§4) — DSL eval, capability, who emits which event |
| Self-describing Event model + `Delta` effect model | Gas **pricing** (§9) — how fee/gas *values* are computed (events carry them) |
| `apply(State, Event) → State` — total, deterministic (§7.1/§7.2) | Signature verification (crypto) |
| `materialize(events)` = fold from genesis; snapshot (§3.3) | TON reorg handling for mirrored events (§7.4 transport) |
| All-or-nothing via per-CAL effect staging (§3.5) | Bounded-Mode trigger *thresholds* (Tier-1 params; recompute logic is in) |
| Nonce / per-agent serialization invariants (§6) | |
| Bounded-Mode flag recompute at tick boundary (§10.1) | |
| Shadow-balance lazy init (§11.1) | |
| `STATE_ROOT` after each event (reuses canonical `stateRoot`) | |

---

## 3. State model (provisional — the future Annex B)

State is the canonical-JSON map of the **eight namespaces** (names per §7.3, sorted by
UTF-8: `state.cal`, `state.failure_mode`, `state.governance`, `state.oracles`,
`state.ptra`, `state.registry`, `state.tick`, `state.treasury`). `STATE_ROOT` is
`canonical.stateRoot(...)` over each namespace's canonical bytes — already NORMATIVE.

Minimal schemas sufficient for the event set below (extend under Annex B):

```
state.cal          { in_flight: map<cal_hash, InFlight>, nonces: map<agent_id, uint64> }
                     InFlight = { agent_id, stage, fee_debited_ptra:uint256,
                                  gas_consumed_ptra:uint256, staged: [Delta] }
state.ptra         { balances: map<addr, uint256> }          // absent ⇒ 0 (§11.1)
state.treasury     { nav:uint256, developer_fund_balance:uint256, collected_fees_window:uint256 }
state.registry     { agents: map<agent_id, Agent>, mcp_schema_hash:bytes32 }
                     Agent = { capability, frozen_until:uint64, wallet_balance_ton:uint256 }
state.failure_mode { is_bounded_mode:bool, capture_guard_counters: map<key,uint64> }
state.governance   { gas_price_nano_ptra_per_unit:uint64, genesis_validator_set:[addr], params }
state.oracles      { feeds: map<symbol, Feed> }
state.tick         { current:uint64 }
```

**Genesis** = every namespace present with empty maps / zero scalars,
`is_bounded_mode=false`, `tick.current=0`, plus the constitutional constants
(`genesis_validator_set`, `mcp_schema_hash`, `gas_price_nano_ptra_per_unit=1000`).
Genesis is a fixed, hashable value with a pinned `STATE_ROOT`.

Integer fields are uint256/uint64; arithmetic is checked (underflow → `ApplyError`).

---

## 4. Event model & the `Delta` effect language

Every event is a canonical object `{ event_type, ...fields }`. Beyond the lifecycle fields
(CAL skeleton §6), state-changing events carry their effect explicitly:

```
Delta = { ns: "<namespace>", op: "set" | "add" | "sub" | "delete",
          path: [seg, ...], value?: JcsValue }
  set    : state[ns].path  = value
  add/sub: state[ns].path ±= value      (checked uint; underflow ⇒ ApplyError)
  delete : remove key at state[ns].path
```

- `cal.executed` carries `effects: [Delta]` — the *observed* result of running each step
  (PTRA/registry/treasury mutations from MCP/chain), plus `gas_consumed_ptra`. The reducer
  **stages** these (does not touch committed namespaces) until finalize.
- `cal.validated` carries `fee_debited_ptra` (computed by the gas phase). The reducer
  debits it immediately (committed — it is the non-refundable anti-spam charge, §9.4).
- `cal.failed` / `cal.expired` for a **pre-VALIDATED** CAL (stage `CREATED`/`SIGNED`)
  carries `fee_debited_ptra` too — the §9.4 spam charge that was never escrowed
  because no `cal.validated` fired. The reducer debits it from the agent and retains
  it at the terminal event (§9.4 Tier-2 revision, 2026-05-26). The validator bakes in
  `min(fee, balance)`, so the debit never underflows; a no-charge failure
  (`UNKNOWN_ACTION`/`NONCE_MISMATCH`/`PRECOND_ERROR`/escrow shortfall) carries `0`.
- `cal.finalized` carries `gas_refunded_ptra` and the receipt fields (§5.1).
- Mirrored externals `ptra.transferred`, `oracle.feed_submitted` (§7.4) carry their deltas
  and apply **immediately** (they are external facts, not staged).
- `tick.advanced { new_tick }` advances `state.tick.current` and triggers the Bounded-Mode
  recompute (§9 below).
- `ptra.shadow_init { addr }` materializes a `0` balance (§11.1).

Because step effects are pre-observed Deltas, the reducer is a pure function of
(State, Event) — no MCP, no clock, no RNG.

---

## 5. The reducer table (proposed Annex B)

`apply : (State, Event) → Result<State, ApplyError>`. Each row lists the precondition
(deterministically checked; violation ⇒ typed `ApplyError`, never an exception) and the
mutation. `H = in_flight[cal_hash]`.

| event | precondition | mutation |
|-------|--------------|----------|
| `cal.created` | `cal_hash ∉ in_flight`; no in-flight CAL for `agent_id` (§6.1) | `in_flight[cal_hash] = {agent_id, stage:CREATED, staged:[], fees:0}` |
| `cal.signed` | `H.stage == CREATED` | `H.stage = SIGNED` |
| `cal.validated` | `H.stage == SIGNED`; `balances[agent_id] ≥ fee_debited_ptra` | `H.stage = VALIDATED`; `balances[agent_id] -= fee_debited_ptra`; `H.fee_debited_ptra = fee_debited_ptra` |
| `cal.executed` | `H.stage == VALIDATED` | `H.stage = EXECUTED`; `H.staged = effects`; `H.gas_consumed_ptra = gas_consumed_ptra` |
| `cal.settled` | `H.stage == EXECUTED` | `H.stage = SETTLED` |
| `cal.finalized` | `H.stage == SETTLED` | **commit** `H.staged` to namespaces; `balances[agent_id] += gas_refunded_ptra`; `treasury.collected_fees_window += (H.fee_debited_ptra + H.gas_consumed_ptra − gas_refunded_ptra)`; `nonces[agent_id] += 1`; `delete in_flight[cal_hash]` |
| `cal.failed` / `cal.expired` | `H.stage` non-terminal | **discard** `H.staged`; if `H.stage ∈ {CREATED, SIGNED}` debit the event's `fee_debited_ptra` (= `chargeNow`, the §9.4 spam charge, never escrowed pre-VALIDATED) from `balances[agent_id]` — else `chargeNow = 0`; `treasury.collected_fees_window += (H.fee_debited_ptra + H.gas_consumed_ptra + chargeNow)`; `nonces[agent_id] += 1`; `delete in_flight[cal_hash]` |
| `ptra.transferred` | — | apply carried deltas to `ptra.balances` (lazy-init absent ⇒ 0) |
| `oracle.feed_submitted` | — | `oracles.feeds[symbol] = aggregated` (value carried) |
| `tick.advanced` | `new_tick > tick.current` | `tick.current = new_tick`; recompute `failure_mode.is_bounded_mode` (§9) |
| `ptra.shadow_init` | `addr ∉ balances` | `balances[addr] = 0` |

Unknown `event_type`, or a precondition violation, ⇒ `ApplyError{code}` (typed value). The
fold's behavior on error is fixed in §7.

---

## 6. All-or-nothing via staging (§3.5)

Committed namespaces change at **`cal.validated`** (fee debit, non-refundable),
**`cal.finalized`** (commit staged step effects + gas refund), and — since the §9.4
Tier-2 revision — at a **pre-VALIDATED `cal.failed`/`cal.expired`** (the spam-fee debit,
also non-refundable, for a CAL rejected before it could escrow at `cal.validated`).
Between validated and finalized, step effects live in `H.staged`. Rollback on
`cal.failed`/`cal.expired` is therefore just *dropping the staged delta* (and, when
pre-VALIDATED, charging the carried spam fee) — no `state.before`/`state.after` snapshot
is needed in the reducer. (The spec's §7.1 sketch phrases the rollback as "rollback
state.after to state.before"; staging is the equivalent, reducer-friendly formulation
and is the recommended model.)

---

## 7. Determinism, totality, error model

- `apply` is **total**: it returns `Result<State, ApplyError>`; malformed/illegal events
  yield a typed `ApplyError` (not a panic/exception), per §7.1.
- **Determinism (§7.2):** for identical (State, Event) bytes, every implementation returns
  identical result bytes (or the identical `ApplyError`). Enforced by golden vectors +
  differential fuzzing, exactly like the canonical/DSL/CAL layers.
- All integer math is checked uint256/uint64; underflow (e.g. insufficient balance) ⇒
  `ApplyError` — it never wraps or saturates.
- Map iteration never affects results (lookups/writes only); canonical serialization sorts
  keys, so `STATE_ROOT` is independent of insertion order.

`ApplyError` codes (initial): `DUPLICATE_CAL`, `AGENT_BUSY`, `BAD_STAGE`, `UNKNOWN_CAL`,
`INSUFFICIENT_BALANCE`, `UNDERFLOW`, `UNKNOWN_EVENT`, `BAD_DELTA`.

---

## 8. Fold, materialize, snapshot (§3.3)

```
materialize(events)            = events.fold(genesis, apply)
snapshot(tick)                 = materialize(events_up_to(tick − 1))      (§3.3)
state_root_after_each(events)  = scan(genesis, apply) ▷ stateRoot
```

The validator reads `snapshot(current_tick)` (the last finalized tick) — the reducer
provides `materialize`; the validator does the evaluation against it.

---

## 9. Bounded-Mode recompute & shadow balances

- On `tick.advanced`, recompute deterministically (§10.1):
  `is_bounded_mode := oracle_response_rate_window < 0.70 OR nav_delta_per_tick < −X OR
  max(capture_guard_counters) ≥ THRESHOLD`. The inputs are all in State; `X`/`THRESHOLD`
  are Tier-1 params in `state.governance`. Transitions emit `failure_mode.enter/exit_bounded`
  (the validator emits these; the reducer applies the flag). Recompute is pure.
- Shadow balance (§11.1): `balances` lookups treat an absent `addr` as `0`; an explicit
  `ptra.shadow_init` event materializes the `0` so the first reference is replay-stable.

---

## 10. Module layout, golden & fuzz plan

```
cal-reducer/      (TypeScript reference, @paradigm-terra/cal-reducer)
  src/ state.ts (model + genesis + namespace canonical-ization)
       delta.ts (Delta application, checked uint math)
       apply.ts (the reducer table), fold.ts (materialize/scan), index.ts
cal-reducer-rs/   (Rust parity — reuses canonical-rs + cal-rs)
cal-reducer-go/   (Go parity — reuses canonical-go + cal-go)
```

Golden vectors: curated **(genesis, event-sequence)** fixtures pinning the resulting
`STATE_ROOT` (and the per-event `STATE_ROOT` scan), plus `ApplyError` cases. Generated by
the TS reference, reproduced byte-for-byte by Rust + Go, then PRE-NORMATIVE → NORMATIVE.
A differential fuzzer feeds random *well-formed* event sequences and asserts zero
`STATE_ROOT` divergence across the three — mirroring the canonical layer's diff-fuzz gate.

---

## 11. Open design decisions (defaults chosen; flag if you disagree)

1. **All-or-nothing model** — default **per-CAL staging** (§6): commit at finalize, discard
   on fail. Alternative: explicit `state.before`/`state.after` snapshots (heavier, but
   literal to the §7.1 wording).
2. **Self-describing events** — default **events carry concrete `Delta`s + economic values**
   (§4), so the reducer never recomputes MCP/gas. This is what keeps the gas phase separable
   and the reducer deterministic; the alternative (reducer recomputes effects) is not viable
   for external side effects.
3. **`apply` error surface** — default `Result<State, ApplyError>` with a closed code enum
   (§7). The fold aborts on the first `ApplyError` (consensus would never admit such a log).
4. **State schema concreteness** — the §3 schemas are provisional pending Annex B; the
   reducer treats unknown namespace sub-fields opaquely so schema growth does not break
   existing `STATE_ROOT`s for the covered event set.
```
