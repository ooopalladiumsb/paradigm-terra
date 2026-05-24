# @paradigm-terra/dsl

TypeScript reference implementation of **DSL v1.2** — the deterministic,
total, sandboxed expression language used in CAL preconditions, step
post-conditions, top-level invariants, and capability gates.

DSL v1.2 is a backwards-compatible extension of the frozen **Constraint DSL
v1.1** (SCF): every v1.1 expression evaluates identically under v1.2; only the
hash domain tag differs. v1.2 adds bracketed state (`state.before` /
`state.after`), action-reference literals, the gate-only operators
`requires_scope` / `is_owner_required`, and the Bounded-Mode emergency
invariant set.

- Specs: [`docs/spec/constraint-dsl-v1.1.md`](../docs/spec/constraint-dsl-v1.1.md),
  [`docs/draft/dsl-spec-v0.1.0-draft.md`](../docs/draft/dsl-spec-v0.1.0-draft.md)
- Built on [`@paradigm-terra/canonical`](../canonical) for restricted-JCS
  canonicalization, domain-separated SHA-256, NFC (Unicode 15.1 pinned), and
  canonical TON address handling — so DSL hashing is byte-identical to the
  encoding spec.

## What it does

| Module | Responsibility |
|--------|----------------|
| `parse` | structural validation → typed AST: operator/arity, AST depth ≤ 10, ≤ 100 nodes, path-depth (6, or 7 for bracketed), scope rules, cost ≤ 1000 |
| `evaluate` | total evaluator over `int256 / bool / string / bytes32 / address / list / map / null`; int256 arithmetic with overflow→ERROR, truncating `div`, Euclidean `mod` |
| `values` | runtime value model + DSL type system + structural equality |
| `taxonomy` | registered action enum (CAL §2.3), `OWNER_REQUIRED_ACTIONS` (§8.2), provisional `requires_scope` table (CAL Annex A pending) |
| `hash` | `DSL_HASH = SHA256("PARADIGM_TERRA_DSL_V1.x" ‖ canonical_json(expr))` |
| `envelope` | `{dsl_version, expr}` parsing |
| `emergency` | Bounded-Mode injected invariant set (§7.1) |

## Outcomes

Evaluation yields exactly one normative outcome (Constraint DSL v1.1 §5):
`PARSE_ERROR`, `VALIDATION_ERROR`, `EVALUATION_TRUE`, `EVALUATION_FALSE`, or
`ERROR`. `ERROR` is a *local* fault (div/0, overflow, missing variable, null
misuse) and never escalates to `CONSENSUS_UNCERTAINTY`. Every implementation
MUST agree on the outcome **and** its reason sub-code; the golden vectors pin
both.

```ts
import { run } from "@paradigm-terra/dsl";

run(
  { op: "gte", lhs: { var: "state.ptra.balances.0:e879…" }, rhs: { const: 100000000n } },
  { scope: "precondition", version: "1.2", bindings: { state: { ptra: { balances: { "0:e879…": 200000000n } } } } },
);
// → { code: "EVALUATION_TRUE" }
```

## Build / test

```
npm run build        # tsc → dist/
npm run typecheck
npm test             # node --test (35 tests)
npm run vectors:generate   # regenerate vectors/golden.json
npm run vectors:verify     # re-check the golden vectors
```

## Golden vectors & parity

`vectors/golden.json` pins, for each (expression, scope, version, bindings),
the evaluation outcome + reason and the `DSL_HASH`. Status is **PRE-NORMATIVE**:
promote to NORMATIVE once the planned `dsl-rs` (Rust) and `dsl-go` (Go) parity
ports reproduce every outcome and hash byte-for-byte — mirroring the canonical
layer's workflow.

## Draft-status caveats

This tracks `docs/draft/` specs (no normative force until Tier 3 ratification):

- `requires_scope`'s action→scope table is **provisional** pending CAL Annex A.
- The full capability-gate **compiler** (DSL v1.2 §6.2, "one clause per scope
  flag") is deferred until the Constitution §V scope-flag list is frozen; the
  gate **operators** and gate-variable scoping are implemented.

## License

MIT — see [`../LICENSE`](../LICENSE).
