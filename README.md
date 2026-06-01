# Paradigm Terra

Protocol specifications and reference implementations for **Paradigm Terra** — a
deterministic, event-sourced governance/execution protocol for agentic wallets on
TON. The repository pairs the **normative specifications** with **byte-for-byte
verified reference implementations** of the canonical encoding in three languages.

## Status

> **Protocol Freeze Candidate — PFC-1 (2026-05-29).** The normative core is structurally complete: canonical encoding, DSL, CAL (skeleton + reducer + gas + validator), orchestrator, MCP schema-hash pin (TS / Rust / Go parity), TON Connect owner-sig ingress, and a TON mainnet economic anchor are all in place with NORMATIVE golden vectors. New protocol changes are now expected to go through compatibility review rather than free editing; implementation pressure is the primary source of remaining truth. Criteria for promotion to actual Consensus Freeze are listed under **PFC-1 → Freeze gates** below.

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
- **Orchestrator / node** (`@paradigm-terra/orchestrator`, TypeScript) — the
  integration layer: folds a program of per-tick `{cal, trace}` submissions through
  `cal.created`/`cal.signed` → `validate()` → `apply()` over one evolving `State`,
  enforcing §6.1 serialization + §6.2 nonce streams, advancing ticks, and recording
  the STATE_ROOT per event and the Canonical Encoding §6.3 global Merkle root per
  tick, in TypeScript with Rust (`orchestrator-rs`) and Go (`orchestrator-go`)
  parity. The event log is byte-for-byte replayable (§7.2). Golden vectors
  `NORMATIVE` (reproduced byte-for-byte across all three; 69 checks). `EXPIRED_POST` /
  `AGENT_BUSY` need a staged validator and are deferred. See
  [`docs/notes/orchestrator-design.md`](docs/notes/orchestrator-design.md).
- Active drafts: Constitution v0.10.0, CAL Execution Spec v0.1.0, DSL v1.2
  (see [`docs/draft/`](docs/draft/)).

## PFC-1 contents

Declared **2026-05-29**. The following surfaces are inside the freeze candidate
and are not expected to change before promotion except via the gates below:

- **Identity model** — Wallet V5 ↔ CAL isomorphism (`cal-validator-design.md` §10), `operator_pubkey` MUST byte-match V5 `ContractState.public_key`.
- **Transport** — TON Connect v2 `signMessage` + `ton_proof` for owner-sig ingress (Execution Spec §8.3, `ton-connect-ingress-design.md`).
- **MCP surface** — `MCP_SCHEMA_HASH = cb133fa73023b330edc20801adea7a8eb2c9396dd99bb8ab06122936129fba34` over `@ton/mcp@0.1.15-alpha.16` (40 tools, lex-sorted names-only). Reproducible artifact at [`tools/mcp/`](tools/mcp/), parity NORMATIVE across TS / Rust / Go (11 vectors + 1000-shuffle stress).
- **Gas model** — `gas_units` parity-locked; TON mainnet economic anchor pinned at 2026-05-29 (CAL Spec Annex §C.5, ConfigParam 18 / 20 / 21 / 24 / 25 snapshot from Tonviewer).
- **Governance anchor** — Constitution §6.bis references CAL Spec §4.4 for the MCP pin; re-pinning policy explicit.
- **Validator semantics** — `validate(cal, snapshot, trace) → events` pure function, NORMATIVE goldens across TS / Rust / Go, §10 Bounded Mode, §4.4 MCP schema-hash gate, §8.1/§8.2 sig + pubkey gate.
- **Canonical encoding** — CE v1.3 in Consensus-Freeze since 2026-05-24.
- **Orchestrator** — Track B node, NORMATIVE goldens, replay-clean.

## PFC-1 → Freeze gates

Promotion from PFC-1 to actual Consensus Freeze requires **all** of:

1. **Real Ed25519** — **verify path DONE (2026-06-01).** `operator_sig` = raw Ed25519 over `canonical_bytes`; `owner_sig` = TON Connect v2 Contract A commit (`TC_V2_SIGNDATA_VERIFY_V1`, D1 finding, confirmed on 2 wallets). TS/Rust/Go cross-language parity green, NORMATIVE vectors `spec/vectors/tc_v2_sig_verify_v1/`, validator node-side verifier in TS + Go (`owner-sig.ts` / `owner_sig.go`), Exec-spec §8.3 wired via the §8.4 Tier-2 amendment. *Remaining:* the orchestrator populates the trace `*_sig_present` booleans by calling the verifier (node integration); `validate()` stays a pure function over those booleans by design.
2. **§C.3 ns/op CPU benchmarks** built and every cell within `[0.5×, 2.0×]` of its abstract unit weight.
3. **Staged validator** lifting the single-tick model — `EXPIRED_POST` and `AGENT_BUSY` become reachable (the two states the current orchestrator cannot induce).
4. **End-to-end smoke flow** — at least one signed CAL transits `signData` (owner, Contract A) → `validate()` → `cal.finalized` end-to-end against a TON testnet wallet, even if final on-chain `sendTransaction` publication is stubbed. *(Verify leg now real (gate 1); transport happy-path observed on Tonkeeper/MyTonWallet testnet; the full signed-CAL transit is the remaining piece.)*
5. **30-day quiet period** — no new normative changes to PFC-1 contents during the gating period.

Out of PFC-1 scope (intentionally — addressed post-Freeze):

- W5 external publication (`sendTransaction`) + on-chain Registry contract + Annex F `canonical_to_inner` codec.
- TEP for Agentic Wallet SBT (standardization comes after a battle-tested reference, not before).
- Tolk normative on-chain artifacts.
- Multi-owner (Multisig v2.1) wallet flows.

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
