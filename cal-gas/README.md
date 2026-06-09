# @paradigm-terra/cal-gas

Deterministic **gas pricing & accounting** for CAL (CAL Execution Spec §9): the
gas-unit model, nano-PTRA pricing, the upfront escrow gate (§9.3), and the
per-outcome refund/retention bill (§9.4). Pure functions — the (future) validator
turns these values into event fields; the reducer moves them.

Design note: [`../docs/notes/cal-gas-design.md`](../docs/notes/cal-gas-design.md).
Built on [`@paradigm-terra/canonical`](../canonical) and
[`@paradigm-terra/dsl`](../dsl) — the DSL portion of the gas units is **the same
numbers `dsl.expressionCost` already pins**, so it is parity-locked by construction.

| Module | Responsibility |
|--------|----------------|
| `units` | gas-unit model (§9.2): `staticGasUnits`, `gasUnits(cal, bytes)`, `mcpCallUnits`, `effectsBytes` |
| `pricing` | `gasPrice`, `toNano`, `flatValidationFee`, `maxExpectedDynamicGas`, `escrowRequirement`, `canValidate` (§9.3) |
| `settle` | `settle(outcome, cal, state, bytesWritten) → GasBill` for the five outcomes (§9.4) |

```
gasUnits(cal, bytes) = dslCost(preconditions)
                     + Σ_steps [ mcpCallUnits(verb) + Σ dslCost(post_conditions) ]
                     + Σ_invariants [ 5 + dslCost ]
                     + bytes                       // state rent, 1/byte
escrow = flatValidationFee + (cal.gas_limit_ptra ?? fee × 100)        // §9.3
```

| Outcome | consumed | fee retained | refunded | agent pays |
|---------|----------|--------------|----------|------------|
| `FINALIZED` / `FAILED_EXEC` | `gasUnits·price` (capped at maxGas) | fee | maxGas − consumed | fee + consumed |
| `FAILED_PRECOND` / `EXPIRED_POST` | 0 | fee | maxGas | fee |
| `EXPIRED_PRE` | 0 | 0 | 0 | 0 |

## Out of scope

Final benchmarked unit prices (§9.2 placeholders, Annex C); per-step MCP call
enumeration (here: 1 call/step, classed by verb); and the validator integration —
which event field gets which value, and confirming the reducer's fee arithmetic is
conservative end-to-end (the reducer is frozen).

## Build / test

```
npm run build        # tsc → dist/
npm test             # node --test (10 tests)
npm run vectors:generate
```

## Golden vectors & parity

`vectors/golden.json` pins gas units, pricing, escrow, the §9.3 gate, and the full
`GasBill` for all **six** outcomes across sample CALs/params. Status **NORMATIVE** —
the `cal-gas-rs` (Rust) and `cal-gas-go` (Go) parity ports reproduce every value
byte-for-byte (verified 2026-05-26, after the §9.4 Tier-2 revision: `FAILED_PRECOND`
retains `min(fee, balance)`, new `FAILED_NO_CHARGE` retains nothing).

## Differential fuzzing

A seeded generator (`fuzz/driver.mjs`) feeds identical random `(cal, state,
bytes_written)` inputs to a harness per language; a case **passes** only when TS /
Rust / Go emit byte-identical gas units, escrow, §9.3 gate, and the §9.4 bill for
all six outcomes (the gas layer is a pure, deterministic Tier-3 function). Integers
are bounded below the U256 range so checked-uint sums never overflow.

```
( cd cal-gas-rs && cargo build --bin fuzz_harness )
( cd cal-gas-go && go build -o ../cal-gas/fuzz/bin/gas_go_harness ./cmd/fuzzharness )
node cal-gas/fuzz/driver.mjs --cases 30000 --seed 1
```

## License

MIT — see [`../LICENSE`](../LICENSE).
