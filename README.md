# Paradigm Terra

Protocol specifications and reference implementations for **Paradigm Terra** — a
deterministic, event-sourced governance/execution protocol for agentic wallets on
TON. The repository pairs the **normative specifications** with **byte-for-byte
verified reference implementations** of the canonical encoding in three languages.

## Status

- **Canonical Encoding Specification v1.3** — *Consensus-Freeze* (frozen normative).
- **Conformance gate: CLEAN** (2026-05-24) — 0 divergences across TS / Rust / Go on
  170k random cases + full single-codepoint and pair-sweep Unicode coverage.
- **Golden vectors:** `NORMATIVE` — 44 field comparisons across 17 vectors, recomputed
  independently by each implementation.
- **DSL v1.2** reference implementation — TypeScript (`@paradigm-terra/dsl`)
  parser + total evaluator + `DSL_HASH`, with Rust (`dsl-rs`) and Go (`dsl-go`)
  parity. Golden vectors `NORMATIVE` (reproduced byte-for-byte across all three).
  Tracks the v0.1.0-draft specs.
- **CAL skeleton** — the immutable hashable foundation (wire-format validation,
  `CAL_HASH`, signing payload, event/receipt hashing, lifecycle), in TypeScript
  (`@paradigm-terra/cal`) with Rust (`cal-rs`) and Go (`cal-go`) parity. Golden
  vectors `NORMATIVE` (reproduced byte-for-byte across all three). See
  [`docs/notes/cal-skeleton-design.md`](docs/notes/cal-skeleton-design.md).
- **CAL reducer** — the deterministic `apply(State, Event) → State` fold with
  per-CAL effect staging (§7.1), in TypeScript (`@paradigm-terra/cal-reducer`)
  with Rust (`cal-reducer-rs`) and Go (`cal-reducer-go`) parity. Events are
  self-describing; gas pricing + validator logic remain separate phases. Golden
  vectors `NORMATIVE` (reproduced byte-for-byte across all three); cross-language
  differential fuzzer in `cal-reducer/fuzz/` (gate CLEAN, ~202k cases). See
  [`docs/notes/cal-reducer-design.md`](docs/notes/cal-reducer-design.md).
- **CAL gas** (`@paradigm-terra/cal-gas`, TypeScript) — deterministic §9 pricing &
  accounting: gas units (reusing the DSL cost model), nano-PTRA pricing, upfront
  escrow (§9.3), and the per-outcome refund/retention bill (§9.4), in TypeScript
  with Rust (`cal-gas-rs`) and Go (`cal-gas-go`) parity. Pure functions the
  validator turns into event values. Golden vectors `NORMATIVE` (reproduced
  byte-for-byte across all three; 135 checks each). See
  [`docs/notes/cal-gas-design.md`](docs/notes/cal-gas-design.md).
- **CAL validator** (`@paradigm-terra/cal-validator`, TypeScript) — the last CAL
  piece: a pure `validate(cal, snapshot, trace)` that drives a SIGNED CAL through
  the §3.1 lifecycle, wiring DSL evaluation + capability/owner/nonce/expiration
  checks + gas (cal-gas) into the self-describing stage events the reducer
  consumes, in TypeScript with Rust (`validator-rs`) and Go (`validator-go`)
  parity. Evaluates, does not execute — step effects arrive as a trace (§4.1).
  Golden vectors `NORMATIVE` (reproduced byte-for-byte across all three; 120
  checks each). See
  [`docs/notes/cal-validator-design.md`](docs/notes/cal-validator-design.md).
- Active drafts: Constitution v0.10.0, CAL Execution Spec v0.1.0, DSL v1.2
  (see [`docs/draft/`](docs/draft/)).

## Layout

```
docs/
  spec/    Frozen normative specifications
    canonical-encoding-v1.3.md       Canonical Encoding Specification v1.3 (Consensus-Freeze)
    constraint-dsl-v1.1.md           Constraint DSL Specification v1.1
    constitution-v0.9.5.md           Constitution v0.9.5
    execution-spec-v1.md             Paradigm Terra Execution Specification v1
  draft/   Work-in-progress (v0.x-draft) — NOT normative
    cal-execution-spec-v0.1.0-draft.md
    dsl-spec-v0.1.0-draft.md
    changelog-v0.10.0-draft.md
  notes/   Analysis & design notes
    ANALYSIS.md                      Spec review, discrepancies, prioritized backlog
    SIMULATION_PREVIEW.md
    LINKS.md                         External references (Cocoon, Acton, @ton/mcp, TON AI)

canonical/      TypeScript reference implementation (@paradigm-terra/canonical)
canonical-rs/   Rust parity implementation (musl static, zero C toolchain)
canonical-go/   Go parity implementation (CGO_ENABLED=0)
dsl/            DSL v1.2 reference implementation (@paradigm-terra/dsl, TypeScript)
dsl-rs/         DSL v1.2 Rust parity implementation (musl static, vendored i256)
dsl-go/         DSL v1.2 Go parity implementation (CGO_ENABLED=0, stdlib math/big)
cal/            CAL skeleton: hashable foundation (@paradigm-terra/cal, TypeScript)
cal-rs/         CAL skeleton Rust parity implementation (reuses canonical-rs + dsl-rs)
cal-go/         CAL skeleton Go parity implementation (reuses canonical-go + dsl-go)
cal-reducer/    CAL event reducer: apply(State,Event)→State (@paradigm-terra/cal-reducer, TS) + fuzz/
cal-gas/        CAL gas pricing & accounting §9 (@paradigm-terra/cal-gas, TS)
cal-gas-rs/     CAL gas Rust parity implementation (musl static, vendored u256)
cal-gas-go/     CAL gas Go parity implementation (CGO_ENABLED=0, stdlib math/big)
validator/      CAL validator §3-§9: validate(cal,snapshot,trace)→events (@paradigm-terra/cal-validator, TS)
validator-rs/   CAL validator Rust parity implementation (reuses dsl-rs + cal-gas-rs)
cal-validator-go/ CAL validator Go parity implementation (reuses dsl-go + cal-gas-go)
cal-reducer-rs/ CAL reducer Rust parity implementation (musl static, vendored u256)
cal-reducer-go/ CAL reducer Go parity implementation (CGO_ENABLED=0, stdlib math/big)
fuzz/           Cross-language differential fuzzing harness + gate reports
tools/          Unicode data (DerivedAge-15.1.0) and generators
```

## Reference implementations

The canonical encoding is implemented three times and checked against a single set
of golden vectors generated by the TypeScript reference:

| Impl | Path | Build / test |
|------|------|--------------|
| TypeScript (reference) | `canonical/` | `npm test` |
| Rust (parity) | `canonical-rs/` | `cargo test` |
| Go (parity) | `canonical-go/` | `go test ./...` |

Golden vectors live at `canonical/vectors/golden.json`; the Rust and Go suites load
that file and recompute every vector. All three agree byte-for-byte.

### Unicode pinning

NFC backends differ by Unicode version (Go `x/text` 15.0 vs TS/Rust 17.0). Conformance
is preserved by restricting canonical strings to the **Unicode 15.1 assigned set**
(`sha256(ranges) = 59cb760256e1b8ec76aa6718a574b0e29a263fb37645bed358a137004c56a6d6`).

## License

MIT — see [`LICENSE`](LICENSE).
