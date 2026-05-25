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
each (start state, event sequence), and the `ApplyError` codes. Status **NORMATIVE** —
reproduced byte-for-byte by the Rust ([`../cal-reducer-rs`](../cal-reducer-rs)) and Go
([`../cal-reducer-go`](../cal-reducer-go)) parity implementations.

| Impl | Path | Build / test |
|------|------|--------------|
| TypeScript (reference) | `cal-reducer/` | `npm test` |
| Rust (parity) | `cal-reducer-rs/` | `cargo test` (musl-static, vendored `u256`) |
| Go (parity) | `cal-reducer-go/` | `go test ./...` (stdlib `math/big`) |

## Differential fuzzing

`fuzz/` cross-checks all three implementations on random, model-guided event
sequences (mostly valid CAL lifecycles so the fold runs deep, with occasional
faults for error-path coverage). The identical seeded batch is piped to a harness
per language; a case **passes** only when TS / Rust / Go agree on BOTH the
resulting `STATE_ROOT` AND the `(ApplyError code, index)` of any fault — the
reducer is a total, deterministic Tier-3 function (§7.2), so zero divergence is
required.

```
# build the parity harnesses, then run
( cd cal-reducer-rs && cargo build --bin fuzz_harness )
( cd cal-reducer-go && go build -o ../cal-reducer/fuzz/bin/reducer_go_harness ./cmd/fuzzharness )
node cal-reducer/fuzz/driver.mjs --cases 50000 --seed 1
```

Harnesses share the line protocol in [`fuzz/ts_harness.mjs`](fuzz/ts_harness.mjs):
each line is the hex of canonical-JSON `{ start, events }`; output is
`OK <state-root>` or `ERR <CODE>@<index>`. Divergences (none expected) are written
to `fuzz/out/reducer_divergences.jsonl` with the offending case for replay.

## License

MIT — see [`../LICENSE`](../LICENSE).
