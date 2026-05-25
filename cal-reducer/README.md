# @paradigm-terra/cal-reducer

The deterministic **CAL event reducer** (CAL Execution Spec v0.1.0-draft §7.1):

```
apply : (State, Event) → State          // pure, total
materialize(events) = events.fold(genesis, apply)
```

Design note: [`../docs/notes/cal-reducer-design.md`](../docs/notes/cal-reducer-design.md).
Built on [`@paradigm-terra/canonical`](../canonical) (`STATE_ROOT`, §7.3) and
[`@paradigm-terra/cal`](../cal) (lifecycle / event vocabulary).

## Core idea — self-describing events

The reducer **never re-derives anything**. The validator observes step/MCP effects
and bakes them into the event as concrete `Delta`s; the gas phase computes the
fee/gas *values* and puts them in the event. `apply` just **replays the deltas and
moves the carried values** — so it is byte-for-byte deterministic across TS / Rust /
Go even though execution touches non-deterministic externals. The non-determinism
lives in the (consensus-agreed) log, never in the reducer.

| Module | Responsibility |
|--------|----------------|
| `state` | the 8 namespaces (§7.3), genesis, `STATE_ROOT`, immutable path helpers |
| `delta` | the `{ns, op:set/add/sub/delete, path, value}` effect language, checked uint256 |
| `apply` | the reducer table (§7.1) — per-event precondition + mutation |
| `fold` | `materialize` / `scanStateRoots` |
| `errors` | total error model — `ApplyError` (typed value, never thrown at the boundary) |

## All-or-nothing via staging

Step effects accrue in `in_flight[cal_hash].staged`; committed atomically at
`cal.finalized`, **dropped** on `cal.failed` / `cal.expired`. Committed namespaces
change only at `cal.validated` (the non-refundable fee) and `cal.finalized`. So
rollback is "drop the staged delta" — no `before`/`after` snapshots.

## Out of scope (other phases)

Gas **pricing** (§9 — events carry the values), the validator decision logic (§4 —
DSL eval, capability, *which* event to emit), and signature crypto.

## Build / test

```
npm run build        # tsc → dist/
npm test             # node --test (8 tests)
npm run vectors:generate
```

## Golden vectors & parity

`vectors/golden.json` pins the genesis `STATE_ROOT`, the per-event `STATE_ROOT` for
each (start state, event sequence), and the `ApplyError` codes. Status
**PRE-NORMATIVE** — promote to NORMATIVE once the planned `cal-reducer-rs` (Rust) and
`cal-reducer-go` (Go) parity ports reproduce every root and code byte-for-byte, with a
differential fuzzer asserting zero `STATE_ROOT` divergence on random well-formed
sequences.

## License

MIT — see [`../LICENSE`](../LICENSE).
