# @paradigm-terra/cal

The **immutable, hashable foundation** of the Constitutional Action Language
(CAL Execution Spec v0.1.0-draft). This layer is everything about CAL that is
computable from a blob alone — the part the reducer and gas phases later build
on **without changing any committed hash**.

Design note: [`../docs/notes/cal-skeleton-design.md`](../docs/notes/cal-skeleton-design.md).
Built on [`@paradigm-terra/canonical`](../canonical) (JCS, domain-hash, state
root, event-log Merkle, framing) and [`@paradigm-terra/dsl`](../dsl) (embedded
expression parse-validation + taxonomy).

## In scope (frozen / hashable)

| Module | Responsibility |
|--------|----------------|
| `schema` | CAL/Step/Signatures wire-format validation (§2.1): field types, registered action/verb taxonomy, canonical address, uint ranges, and **parse-validation** of every embedded DSL expression at its correct scope (never evaluated) |
| `hash` | `canonicalUnsignedBytes` (signature-free), `calHash` (§2.2), `eventHash`, `receiptHash` (§5); re-exports `stateRoot` / `streamTreeRoot` from the canonical layer |
| `lifecycle` | stage + event-type enums, terminal set, `reason_code` enum, stage→event-type transition table (§3) |
| `events` | canonical `cal.finalized` / `cal.failed` / `cal.expired` receipt builders (§5) |

```
CANONICAL_UNSIGNED = canonical_bytes(CAL without the "signatures" key)   (§8.3)
CAL_HASH      = SHA256("PARADIGM_TERRA_CAL_V1"     || CANONICAL_UNSIGNED) (§2.2)
SIGN_PAYLOAD  = CANONICAL_UNSIGNED   ← Ed25519 signs this exact byte string
RECEIPT_HASH  = SHA256("PARADIGM_TERRA_RECEIPT_V1" || canonical_bytes(event))
```

`CAL_HASH` and the signing payload are the **same** bytes by construction.

## Deferred (intentionally absent)

The `apply(state, event) → state` reducer (§7.1), gas accounting (§9), Ed25519
verification, the validator snapshot / capability checks (§4), and Bounded-Mode
runtime (§10). Receipt schemas already reserve the gas / state-root fields, so
those phases fill **values** without perturbing the hash format.

## Build / test

```
npm run build        # tsc → dist/
npm test             # node --test (15 tests)
npm run vectors:generate
```

## Golden vectors & parity

`vectors/golden.json` pins validation outcomes (code + detail), `CAL_HASH`,
canonical unsigned bytes, and event/receipt hashes. Status **NORMATIVE** —
reproduced byte-for-byte by the Rust ([`../cal-rs`](../cal-rs)) and Go
([`../cal-go`](../cal-go)) parity implementations.

| Impl | Path | Build / test |
|------|------|--------------|
| TypeScript (reference) | `cal/` | `npm test` |
| Rust (parity) | `cal-rs/` | `cargo test` (musl-static, reuses canonical-rs + dsl-rs) |
| Go (parity) | `cal-go/` | `go test ./...` (reuses canonical-go + dsl-go) |

## License

MIT — see [`../LICENSE`](../LICENSE).
