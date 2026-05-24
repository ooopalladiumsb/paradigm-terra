# CAL Skeleton Design — the immutable, hashable foundation

**Status:** Design note (not normative). Targets CAL Execution Spec v0.1.0-draft.
**Date:** 2026-05-24
**Goal:** Define the *deterministic, hashable* core of CAL — wire format, canonical
hashing, signing payload, lifecycle/event/receipt types — so the reducer (`apply`)
and gas phases can later be layered on top **without changing any committed hash**.

The guiding invariant: **everything in this layer is computable from a CAL blob (and,
for receipts, from already-materialized state roots) alone — no state transition, no
gas pricing, no signature crypto.** Those are the deferred phases.

---

## 1. Scope boundary

| In (frozen, hashable) | Deferred (later phases) |
|------------------------|--------------------------|
| CAL wire schema + structural validation (§2.1) | `apply(state, event) → state` reducer (§7.1, Annex B) |
| `CAL_HASH` (§2.2) | Gas accounting / pricing / refunds (§9, Annex C) |
| Canonical **unsigned signing payload** (§8.3) | Ed25519 signature **verification** (crypto) |
| Action/verb taxonomy checks (§2.3) — reuse DSL taxonomy | Validator snapshot read + capability check (§4) |
| Embedded-DSL **parse-validation** at correct scope (§4 DSL spec) | DSL **evaluation** (needs state) |
| Lifecycle stage + event-type enums, terminal set, transition table (§3) | Per-tick expiration / nonce-monotonicity checks (runtime) |
| `reason_code` enum (§3.5) | Bounded-Mode triggers / whitelist runtime (§10) |
| Event & receipt schemas + `EVENT_V1` / `RECEIPT_HASH` (§3.2, §5) | Event-log aggregation (uses canonical `streamTreeRoot`) |
| `STATE_ROOT` (§7.3) — **already in canonical layer**, re-exported | TON event mirroring (§7.4) |

Note: receipt schemas *include* gas fields (`gas_consumed_ptra`, …) and the gas phase
fills their **values**; their **structure and hashing are frozen here**, so adding gas
never perturbs the receipt hash format.

---

## 2. Layering

```
canonical  (CE v1.3, Consensus-Freeze)   ── JCS, SHA-256+domain, NFC, address,
   ▲                                         framing, binaryMerkle, stateRoot,
   │                                         streamTreeRoot, domain-tag registry
   ├── dsl  (DSL v1.2, NORMATIVE)         ── parse/validate/evaluate, DSL_HASH,
   │                                         action taxonomy, OWNER_REQUIRED_ACTIONS
   └── cal  (THIS LAYER)                  ── CAL schema+validation, CAL_HASH,
                                             signing payload, event/receipt hashing,
                                             lifecycle types  (no reducer, no gas)
```

`cal` depends on both `canonical` and `dsl`. Mirrors the DSL rollout: TypeScript
reference (`cal/`) + Rust (`cal-rs/`) + Go (`cal-go/`) parity, one golden-vector file
promoted to NORMATIVE once all three reproduce it byte-for-byte.

---

## 3. CAL wire format & structural validation (§2.1)

A CAL is a restricted-JCS object:

| Field | Type | Validation (frozen, state-free) |
|-------|------|----------------------------------|
| `cal_version` | string | MUST equal `"0.1.0"` |
| `action` | string | `namespace.verb` ∈ taxonomy (DSL `isRegisteredAction`) |
| `agent_id` | address | canonical `workchain:hex256` |
| `nonce` | uint64 | integer in `[0, 2^64-1]` |
| `expiration_tick` | uint64 | integer in `[0, 2^64-1]` |
| `preconditions` | DSL expr | parses + validates at scope `precondition` |
| `invariants` | list\<DSL expr\> | each parses at scope `invariant` |
| `steps` | list\<Step\> | non-empty; each Step validated below |
| `receipt_required` | bool | — |
| `signatures` | Signatures | structural only (no crypto) |
| `compatibility_pragma` | string? | optional; if present, `"v0.9.5"` |

**Step** = `{ verb: string, params: object, post_conditions?: list<DSL expr> }`:
`verb` ∈ taxonomy and shares the top-level `action`'s **namespace** (the chosen reading
of §2.1 "consistent with"); `params` validated as canonical JCS only (opaque here); each
`post_conditions` entry parses at scope `post_condition`.

**Signatures** = `{ operator_sig: bytes, owner_sig?: bytes, sponsor_sig?: bytes }`;
each present field is a hex/`0x` byte string. Presence/validity of `owner_sig` per
`OWNER_REQUIRED_ACTIONS` is an **authorization** check (deferred to the validator) — the
skeleton only validates shape.

Embedded DSL is **parse-validated but never evaluated** here. Default: expressions are
**bare** ASTs (as in the §12 examples) evaluated under **DSL v1.2** (CAL v0.1.0+ pins
DSL v1.2 per DSL §2); the `{dsl_version, expr}` envelope is accepted as an alternate
form. (Open point 9.1.)

---

## 4. Hashable artifacts (exact byte layouts)

All `canonical_bytes(x)` = restricted-JCS serialization (`canonicalizeValue`); all hashes
are `SHA256(ascii(tag) || payload)` via the canonical `domainHash`.

```
unsigned_cal      := the CAL object with the "signatures" key omitted entirely (§8.3)
CANONICAL_UNSIGNED := canonical_bytes(unsigned_cal)

CAL_HASH      = SHA256("PARADIGM_TERRA_CAL_V1"     || CANONICAL_UNSIGNED)        (§2.2)
SIGN_PAYLOAD  = CANONICAL_UNSIGNED                                              (§8.3)
                  └─ operator_sig / owner_sig / sponsor_sig are Ed25519 over this exact byte string

EVENT_HASH(e)   = SHA256("PARADIGM_TERRA_EVENT_V1"   || canonical_bytes(e))      (generic event)
RECEIPT_HASH(e) = SHA256("PARADIGM_TERRA_RECEIPT_V1" || canonical_bytes(e))      (§5.1/§5.2 — terminal events)

STATE_ROOT(namespaces) = canonical.stateRoot(...)                               (§7.3, already implemented)
EVENT_LOG_ROOT(events) = canonical.streamTreeRoot(...)                          (CE §6.3 — aggregation deferred)
```

`CAL_HASH` and `SIGN_PAYLOAD` derive from the **same** byte string `CANONICAL_UNSIGNED`,
so one function produces it and both consumers reuse it. The DSL hashing layer already
proves that omit-a-key + re-canonicalize is deterministic across TS/Rust/Go.

---

## 5. Lifecycle, events, reason codes (§3)

**Stages:** `CREATED → SIGNED → VALIDATED → EXECUTED → SETTLED → FINALIZED`, with `FAILED`
and `EXPIRED` reachable from any non-terminal stage. **Terminal:** `FINALIZED`, `FAILED`,
`EXPIRED`.

**Event types** (the cal.* lifecycle): `cal.created`, `cal.signed`, `cal.validated`,
`cal.executed`, `cal.settled`, `cal.finalized`, `cal.failed`, `cal.expired`. The skeleton
encodes the **stage→event-type transition table** and the rule "no two events for the same
`(cal_hash, event_type)`" as frozen constants/validators — *not* the reducer that applies
them.

**`reason_code`** (§3.5, closed enum): `PRECOND_FALSE`, `PRECOND_ERROR`, `CAPABILITY_DENIED`,
`NONCE_MISMATCH`, `STEP_ERROR`, `POSTCOND_FALSE`, `INVARIANT_FALSE`, `OUT_OF_GAS`,
`UNKNOWN_ACTION`, `BOUNDED_BLOCKED`, `SCHEMA_MISMATCH` (+ `CANCELLED`, §6.3).

---

## 6. Event & receipt schemas (§5)

**`cal.finalized`** (the positive receipt):
`{ event_type, cal_hash:bytes32, agent_id:address, nonce:uint64, tick_finalized:uint64,
state_root_before:bytes32, state_root_after:bytes32, gas_consumed_ptra:uint256,
ton_ingress_fee_paid:uint256, steps_applied:uint16, invariants_checked:uint16 }`

**`cal.failed`** / **`cal.expired`** (negative receipts):
`{ event_type, cal_hash, agent_id, nonce, tick_*, reason_code, reason_detail, gas_consumed_ptra,
ton_ingress_fee_paid }`

The skeleton defines these schemas + `RECEIPT_HASH`; gas/state-root **values** are supplied
by later phases but the **layout and hash are fixed now**.

---

## 7. Module / package layout

```
cal/         (TypeScript reference, @paradigm-terra/cal)
  src/
    schema.ts      CAL/Step/Signatures types + structural validator (reuses dsl.parseExpression)
    hash.ts        canonicalUnsigned(), calHash(), eventHash(), receiptHash()
    lifecycle.ts   Stage / EventType enums, terminal set, transition table, reason codes
    events.ts      cal.finalized / cal.failed / cal.expired builders + receipt hashing
    index.ts
  vectors/golden.json
  test/, scripts/generate-vectors.ts
cal-rs/      (Rust parity — reuses canonical-rs + dsl-rs; no build-script deps)
cal-go/      (Go parity — reuses canonical-go + dsl-go)
```

API surface (TS):
`validateCal(jcs) → Cal | DslError-like`, `canonicalUnsignedBytes(cal) → Uint8Array`,
`calHash(cal) → bytes32`, `receiptHash(event) → bytes32`, `eventHash(event) → bytes32`,
plus the lifecycle enums + `transitionEventType(from, to)`.

---

## 8. Golden-vector plan

Vectors pin, for curated CALs and events: `CANONICAL_UNSIGNED` (hex), `CAL_HASH`,
`RECEIPT_HASH`/`EVENT_HASH`, and structural-validation outcomes (valid / specific error).
Generated by the TS reference, re-verified byte-for-byte by `cal-rs` and `cal-go`, then
promoted PRE-NORMATIVE → NORMATIVE — same workflow as canonical and dsl.

---

## 9. Open design decisions (defaults chosen; flag if you disagree)

1. **Embedded DSL form** — default **bare AST under DSL v1.2** (matches §12 examples);
   envelope `{dsl_version, expr}` also accepted. Alternative: require envelopes everywhere.
2. **Verb ↔ action "consistency"** (§2.1) — default **same namespace**; could be exact-equal
   or a per-action allow-set once Annex A lands.
3. **Signature verification** — **deferred** (define `SIGN_PAYLOAD` + Signatures shape only).
   Ed25519 verify is a thin later layer; in Rust it needs a no-build-script curve crate.
4. **Event-log aggregation** — frozen part is the per-event leaf + hash; the log Merkle reuses
   canonical `streamTreeRoot` and is exercised once the reducer produces ordered logs.
```
