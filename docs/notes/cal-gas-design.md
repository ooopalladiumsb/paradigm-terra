# CAL Gas Phase Design — pricing & accounting

**Status:** Design note (not normative). Targets CAL Execution Spec v0.1.0-draft §9
(the future Annex C). **Date:** 2026-05-25.
**Goal:** A deterministic, pure pricing layer that computes the **PTRA values** the
self-describing events carry — gas units → nano-PTRA, the flat validation fee, the
upfront escrow (§9.3), and the per-outcome refund/retention bill (§9.4). It reuses
the DSL cost model and sits between the DSL/CAL layers and the (future) validator.

---

## 1. Where the gas phase sits

The reducer design fixed the split: **events are self-describing** — the validator
bakes economic *values* into each event and the reducer just moves them. The gas
phase is **how those values are computed**. It is pure (no state mutation, no I/O):

```
gas phase :  (CAL, governance params, observed quantities) → GasBill (nano-PTRA numbers)
validator :  decides the event, fills its fields from the GasBill, enforces §9.3
reducer   :  moves the carried values (already built, NORMATIVE)
```

So the gas phase is buildable and golden-testable in isolation — same workflow as
every prior layer (TS reference → Rust/Go parity → NORMATIVE).

---

## 2. Scope boundary

| In (gas phase) | Deferred / other phases |
|----------------|--------------------------|
| Gas-unit model (§9.2), reusing `dsl.expressionCost` for the DSL portion | Final benchmarked unit prices (§9.2 are placeholders; Annex C) |
| Pricing: `units × gas_price_nano_ptra_per_unit` | Validator integration: which event field gets which value (§4) |
| Flat validation fee + upfront escrow check (§9.3) | End-to-end conservation reconciliation with the reducer's fee arithmetic |
| Per-outcome refund/retention bill (§9.4) | Actual per-step MCP call enumeration (here: 1 call/step, classed by verb) |
| `effectsBytes` helper for state rent | TON ingress fee (off-protocol, §9.1 row 1) |

---

## 3. Gas-unit model (§9.2)

Constant unit costs (placeholders, pending Annex C benchmarks):

```
DSL binary op (eq/lt/add/…)        1     │ reused from dsl.expressionCost, which already
DSL contains_key                  10     │ sums binary=1, contains_key=10, size=20,
DSL size                          20     │ path-segment=2, gate-op=5 (DSL v1.1 §3.2)
DSL path resolution (per segment)  2     │
MCP read-only call  (get_*)       50
MCP write call      (send_*, …)  200
Invariant evaluation        base 5 + DSL cost
State rent                  1 per byte written
```

```
staticGasUnits(cal) =
    dslCost(preconditions)                                  // scope precondition
  + Σ_steps [ mcpCallUnits(step.verb) + Σ dslCost(post_conditions) ]  // scope post_condition
  + Σ_invariants [ 5 + dslCost(invariant) ]                // scope invariant

gasUnits(cal, bytesWritten) = staticGasUnits(cal) + bytesWritten      // + state rent
```

- `dslCost(expr)` = `dsl.expressionCost(expr, {scope, version})` — the *same* numbers
  the DSL layer already pins, so DSL pricing is parity-locked by construction.
- `mcpCallUnits(verb)` = `verbPart.startsWith("get_") ? 50 : 200`. Simplification:
  one MCP call per step, classed by verb (CAL taxonomy verbs are all mutating ⇒ 200;
  `get_*` MCP reads ⇒ 50). The validator may override with observed call counts.
- `bytesWritten` is execution-observed; `effectsBytes(effects)` =
  `len(canonicalizeValue(effects))` is provided as the canonical way to derive it from
  the committed Delta list.

---

## 4. Pricing & escrow (§9.2–§9.3)

```
gasPrice(state)            = state.governance.gas_price_nano_ptra_per_unit   (genesis 1000)
toNano(units, price)       = units × price
flatValidationFee(state)   = state.governance.params.flat_validation_fee_nano_ptra ?? 100_000
maxExpectedDynamicGas(cal, fee) = cal.gas_limit_ptra ?? fee × 100            (§9.3)
escrowRequirement(cal, st) = flatValidationFee(st) + maxExpectedDynamicGas(cal, fee)
canValidate(cal, st, agent)= balances[agent] ≥ escrowRequirement            (§9.3 gate)
```

All amounts are uint256 nano-PTRA (checked; the DSL/reducer u256 discipline).

---

## 5. Per-outcome bill (§9.4)

`settle(outcome, cal, state, bytesWritten) → GasBill` where
`GasBill = { fee_retained, dynamic_gas_consumed, gas_refunded, total_agent_charge }`:

| Outcome | dynamic_gas_consumed | fee_retained | gas_refunded | agent pays |
|---------|----------------------|--------------|--------------|------------|
| `FINALIZED` | `toNano(gasUnits(cal, bytes))` | flat fee | `maxGas − consumed` | flat + consumed |
| `FAILED_PRECOND` (PRECOND_FALSE / CAPABILITY_DENIED) | 0 | flat fee | maxGas | flat |
| `FAILED_EXEC` (STEP_ERROR / POSTCOND / INVARIANT / OUT_OF_GAS) | consumed | flat fee | `maxGas − consumed` | flat + consumed |
| `EXPIRED_PRE` (before VALIDATED) | 0 | 0 | 0 | 0 (TON ingress only) |
| `EXPIRED_POST` (after VALIDATED) | 0 | flat fee | maxGas | flat |

Retained amounts flow to `state.treasury.collected_fees_window` (Constitution §VIII).
The bill is what the validator turns into the reducer's `fee_debited_ptra` /
`gas_consumed_ptra` / `gas_refunded_ptra` event fields — that wiring (and confirming
the reducer's fee arithmetic is conservative end-to-end) is the validator phase.

---

## 6. Module layout & golden plan

```
cal-gas/      (TypeScript reference, @paradigm-terra/cal-gas; deps: canonical + dsl)
  src/ units.ts (gas-unit model + mcp class + effectsBytes)
       pricing.ts (gasPrice/toNano/fee/escrow/canValidate)
       settle.ts (Outcome + GasBill), index.ts
cal-gas-rs/   (Rust parity — reuses canonical-rs + dsl-rs; vendored u256)
cal-gas-go/   (Go parity — reuses canonical-go + dsl-go; math/big)
```

Golden vectors pin, for sample CALs + governance params: `staticGasUnits`, `gasUnits`
at a given `bytesWritten`, `toNano`, `escrowRequirement`, `canValidate`, and the full
`GasBill` for each of the five outcomes. Generated by the TS reference, reproduced
byte-for-byte by Rust + Go, then PRE-NORMATIVE → NORMATIVE.

---

## 7. Open decisions (defaults chosen)

1. **MCP call cost** — default one call/step classed by verb (`get_*`=50 else 200);
   the validator may pass observed call counts later.
2. **Param defaults** — `flat_validation_fee_nano_ptra = 100_000`,
   `gas_price = 1000`, `gas_limit default = fee × 100` (the §9/§12.6 placeholders).
3. **Conservation** — the gas phase only emits the numbers; verifying the reducer's
   `fee_debited + gas_consumed − refund` books balance end-to-end is a validator-phase
   concern (the reducer is already frozen).
```
