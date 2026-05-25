# @paradigm-terra/cal-validator

The deterministic **CAL validator** (CAL Execution Spec v0.1.0-draft §3–§9): the
last CAL piece. One pure function drives a SIGNED CAL through the §3.1 lifecycle
state machine and emits the self-describing stage events the reducer consumes.

```
validate(cal, calHashHex, snapshot, trace) → ValidationResult
       = { events, terminalStage, reasonCode, reasonDetail, bill }
```

It **evaluates**; it does not **execute** (§4.1). External, non-deterministic MCP
step effects arrive in the **execution trace** (`{currentTick, steps:[{ok,
effects, errorDetail?}], stateBefore, stateAfter, ownerSigPresent}`), so the
verdict is decidable from `(cal, snapshot, trace)` alone.

Design note:
[`../docs/notes/cal-validator-design.md`](../docs/notes/cal-validator-design.md).
Wires four frozen layers — [`dsl`](../dsl) (`run`, taxonomy) and
[`cal-gas`](../cal-gas) (escrow gate, settlement) — into one pipeline.

## Pipeline (gate order, §3.1/§4)

action registered → expiration → nonce → owner-sig (OWNER_REQUIRED_ACTIONS) →
scope grant → **preconditions** → escrow gate (§9.3) → `[cal.validated]` → steps
(trace `ok` + **post_conditions**) → dynamic gas vs budget → `[cal.executed]` →
**invariants** → `[cal.settled]` → `[cal.finalized]`. The first failing gate
emits `cal.failed` (reason from §3.5) or `cal.expired`.

## Scope (v0.1.0)

Core deterministic pipeline. The result's `bill` is the **intended** §9.4
settlement; the emitted `events` realize only what the *frozen* reducer books
(failures before `cal.validated` move no PTRA — see design §6). Deferred: real
Ed25519 verification, the full Constitution §V scope matrix, the MCP schema-hash
check (§4.4), and Bounded Mode (§10).

## Golden vectors & parity

`vectors/golden.json` pins, per scenario, the emitted `event_type` sequence, the
terminal stage, `reason_code`, the economic event fields, and the full `bill` —
across the happy FINALIZED path, each reachable reason code, and `EXPIRED`.
Status **PRE-NORMATIVE** — promote once the planned `validator-rs` (Rust) and
`validator-go` (Go) parity ports reproduce every value byte-for-byte.

## License

MIT — see [`../LICENSE`](../LICENSE).
