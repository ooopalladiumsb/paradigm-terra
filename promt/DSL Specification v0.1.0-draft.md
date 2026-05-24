# DSL Specification v0.1.0-draft

**Status:** Draft, co-ratified under Tier 3 with Paradigm Terra Constitution v0.10.0-draft.
**Date:** 2026-05-23
**Profiles:** DSL v1.2 — a backwards-compatible extension of Constraint DSL Specification v1.1 (SCF, 2026-05-13).
**Authoritative dependencies:** Constraint DSL v1.1, CAL Execution Specification v0.1.0-draft, Canonical Encoding v1.3 (SCF), Constitution v0.10.0-draft.
**License:** MIT.

This document defines DSL v1.2 as used inside CAL preconditions, step post-conditions, top-level invariants, and capability gates. DSL v1.1 remains the normative reference for any expression hashed before v0.10.0 ratification; DSL v1.2 is forward-compatible (every v1.1 expression is also a v1.2 expression with identical evaluation result).

---

## 1. Abstract

DSL v1.2 extends DSL v1.1 with:

- **Time-bracketed state access** (`state.before.*`, `state.after.*`) usable only inside step post-conditions and top-level invariants (§4).
- A **registered action reference** (`action.namespace.verb`) usable in capability-gate expressions (§5).
- A **capability-gate sugar** that compiles to a deterministic conjunction of asset-scope and treasury-access checks (§6).
- **Emergency invariants** — a constitutionally injected set of expressions evaluated unconditionally when `state.failure_mode.is_bounded_mode == true` (§7).

No operator from DSL v1.1 is removed or changed. The cost model, AST limits, and ERROR classification are inherited unchanged.

---

## 2. Status & Scope

DSL v1.2 is the only DSL used by CAL v0.1.0+. CAL implementations MUST:

- Reject any DSL expression not declared as `dsl_version: "1.1"` or `dsl_version: "1.2"`.
- Evaluate v1.1 expressions under v1.1 semantics (bit-for-bit) for replay determinism.
- Evaluate v1.2 expressions under the semantics in this document.

Any change to operator semantics or the type system requires a Tier 2 amendment and bumps `dsl_version` to `1.3+`.

---

## 3. Type System (inherited from DSL v1.1)

All types from DSL v1.1 §2 apply unchanged: `int256`, `bool`, `string`, `bytes32`, `address`, `list<T>`, `map<K,V>`, `null`. No new primitive types are introduced in v1.2.

Path-depth limit is raised from 5 to **6 segments** (`state.before.<namespace>.<a>.<b>.<c>`) **only** for `state.before.*` and `state.after.*` paths. All other paths remain at 5. Implementations MUST reject `state.before.*.a.b.c.d.e` (7 segments) with `PARSE_ERROR`.

---

## 4. Post-conditions and Bracketed State

### 4.1. Bracketed state variables

Two new variable roots are recognized inside step `post_conditions` and CAL top-level `invariants`:

| Path root | Meaning |
|-----------|---------|
| `state.before.*` | The snapshot read at VALIDATED (CAL Spec §3.3). |
| `state.after.*` | The state immediately after the enclosing step (for `post_conditions`) or after all steps (for top-level `invariants`). |

These roots are **invalid** in CAL `preconditions` and in capability-gate expressions. Using them outside their scope → `PARSE_ERROR / BRACKETED_STATE_OUT_OF_SCOPE`.

The bare `state.*` root remains valid in preconditions and is equivalent to `state.before.*` inside post-conditions and invariants (i.e. `state.cal.nonces[a]` ≡ `state.before.cal.nonces[a]` when used inside a post-condition).

### 4.2. Evaluation semantics

For each `step ∈ steps`:

1. Compute `state_before_step := state` (the materialized state just before applying the step).
2. Apply the step's verb to produce `state_after_step`.
3. For each expression `e ∈ step.post_conditions`:
   - Bind `state.before := state_before_step`, `state.after := state_after_step`.
   - Evaluate `e`. If result is FALSE or ERROR → CAL → FAILED (`POSTCOND_FALSE` / `POSTCOND_ERROR`).

For top-level `invariants`:

1. `state.before := snapshot at VALIDATED` (CAL Spec §3.3).
2. `state.after := state after all steps applied`.
3. Evaluate each invariant. Same failure semantics.

### 4.3. Determinism

Bracketed-state evaluation is deterministic because both snapshots are themselves canonical byte sequences. Implementations MUST NOT permit any operator inside post-conditions or invariants to read live state outside `state.before.*` / `state.after.*` / `params.*`.

### 4.4. Cost

Reading `state.before.x` or `state.after.x` costs the same as reading `state.x` in DSL v1.1: 2 cost units per path segment.

### 4.5. Hashing

Post-conditions and invariants are hashed exactly like any DSL expression:

```
DSL_HASH = SHA256("PARADIGM_TERRA_DSL_V1.2" || canonical_json(expression))
```

The domain tag changes from `V1.1` to `V1.2` to ensure cache invalidation across versions. v1.1 expressions retain their original `V1.1` tag.

---

## 5. Action Reference

### 5.1. `action.namespace.verb` literal

A new literal form is introduced for capability gates:

```json
{"action": "wallet.send_ton"}
```

Evaluates to a string equal to `"wallet.send_ton"`. The literal is rejected at parse time if the value is not a member of the registered taxonomy (CAL Spec §2.3). This permits capability-gate expressions to refer to actions by name without risking typos or unregistered values.

### 5.2. Action-introspection operators

The following operators are added for use exclusively in capability-gate expressions (§6):

| `op` | Arguments | Semantics |
|------|-----------|-----------|
| `requires_scope` | `action`, `scope` (string) | TRUE iff `scope ∈ required_scopes(action)`. Lookup table is fixed by the constitution and amendable by Tier 2. |
| `is_owner_required` | `action` | TRUE iff `action ∈ OWNER_REQUIRED_ACTIONS` (CAL Spec §8.2). |

Both operators have fixed cost 5. Both are forbidden inside preconditions, post-conditions, and invariants — they are gate-only.

---

## 6. Capability Gates

### 6.1. Purpose

A capability gate is a DSL expression that returns TRUE iff the calling agent's profile permits the CAL's action. Validators invoke the gate automatically at VALIDATED; CAL authors do not write gates themselves. The gate language is exposed here so reference implementations agree on the canonical compilation.

### 6.2. Canonical gate compilation

For an `action` and an agent's `capability` profile, the canonical gate is:

```dsl
{
  "op": "and",
  "args": [
    {
      "op": "or",
      "args": [
        {"op": "not", "arg": {"op": "requires_scope", "args": [{"action": "<action>"}, {"const": "ton_transfer"}]}},
        {"var": "capability.asset_scope.ton_transfer"}
      ]
    },
    {
      "op": "or",
      "args": [
        {"op": "not", "arg": {"op": "requires_scope", "args": [{"action": "<action>"}, {"const": "jetton_access"}]}},
        {"var": "capability.asset_scope.jetton_access"}
      ]
    },
    /* ... one clause per scope flag ... */
    {
      "op": "or",
      "args": [
        {"op": "not", "arg": {"op": "is_owner_required", "args": [{"action": "<action>"}]}},
        {"op": "eq",
         "lhs": {"var": "signatures.owner_sig_valid"},
         "rhs": {"const": true}}
      ]
    }
  ]
}
```

Validators MUST compute this gate identically; the canonical form is part of the conformance suite.

### 6.3. Gate variables

| Variable | Source |
|----------|--------|
| `capability.*` | `state.registry.agents[agent_id].capability` |
| `signatures.owner_sig_valid` | runtime: TRUE iff `signatures.owner_sig` is present and verifies |
| `signatures.sponsor_sig_valid` | runtime: TRUE iff sponsor signature is valid |

These variables are visible **only** inside gate expressions. Using them in user-authored preconditions/invariants → `PARSE_ERROR / GATE_VAR_OUT_OF_SCOPE`.

### 6.4. Gate failure

If the gate evaluates to FALSE → `cal.failed` with `CAPABILITY_DENIED`. If the gate raises ERROR → same failure reason; the error detail is logged but does not enter the Event Log directly.

---

## 7. Emergency Invariants (Bounded Mode)

### 7.1. Constitutionally injected invariant set

When `state.failure_mode.is_bounded_mode == true` at VALIDATED time, the runtime MUST inject the following invariants on top of any declared by the CAL:

```dsl
[
  {
    "op": "gte",
    "lhs": {"var": "state.after.treasury.developer_fund_balance"},
    "rhs": {"var": "state.before.treasury.developer_fund_balance"}
  },
  {
    "op": "gte",
    "lhs": {"var": "state.after.treasury.nav"},
    "rhs": {
      "op": "sub",
      "lhs": {"var": "state.before.treasury.nav"},
      "rhs": {"const": 0}
    }
  },
  {
    "op": "eq",
    "lhs": {"var": "state.after.failure_mode.is_bounded_mode"},
    "rhs": {"const": true}
  }
]
```

The last invariant pins Bounded Mode for the duration of the CAL: a CAL admitted in Bounded Mode MUST NOT transition the system out of Bounded Mode as a side effect; the only path out is the dedicated `failure_mode.exit_bounded` action (CAL Spec §10.5).

### 7.2. Determinism

The injected set is deterministically computed by every validator from `state.failure_mode.is_bounded_mode` alone. It is not part of the CAL hash; it is part of the validator's evaluation context and therefore part of consensus.

### 7.3. Amendability

The injected set is Tier 2 amendable. Any change MUST bump `dsl_version` to `1.3+` because the evaluation behavior of `invariants` is observably altered for replay purposes.

---

## 8. Hashing & Versioning

### 8.1. Version tag in hash

```
DSL_HASH := SHA256("PARADIGM_TERRA_DSL_V1.2" || canonical_json(expression))
```

The domain tag literal `"PARADIGM_TERRA_DSL_V1.2"` MUST be present in the Canonical Encoding §7.1 registry by Tier 2 amendment as a precondition to ratification.

### 8.2. Version field in expression envelope

```json
{
  "dsl_version": "1.2",
  "expr": { ... }
}
```

A CAL MAY contain a mix of v1.1 and v1.2 expressions (e.g. preconditions in v1.1, post-conditions in v1.2). Each expression carries its own `dsl_version`. Implementations MUST evaluate each expression under its declared version.

### 8.3. Cross-version cache

Implementations caching evaluation results MUST key the cache on `(DSL_HASH, snapshot_state_root)`. Because the domain tag differs between versions, identical AST text in v1.1 and v1.2 produces different cache keys, eliminating accidental collisions.

---

## 9. Examples

### 9.1. Post-condition: agent balance strictly decreased

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "lt",
    "lhs": {"var": "state.after.registry.agents.0:83dfd552....wallet_balance_ton"},
    "rhs": {"var": "state.before.registry.agents.0:83dfd552....wallet_balance_ton"}
  }
}
```

### 9.2. Top-level invariant: nonce monotonicity

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "eq",
    "lhs": {"var": "state.after.cal.nonces.0:83dfd552..."},
    "rhs": {
      "op": "add",
      "lhs": {"var": "state.before.cal.nonces.0:83dfd552..."},
      "rhs": {"const": 1}
    }
  }
}
```

### 9.3. Treasury invariant: NAV change bounded by sum of fees

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "lte",
    "lhs": {
      "op": "sub",
      "lhs": {"var": "state.before.treasury.nav"},
      "rhs": {"var": "state.after.treasury.nav"}
    },
    "rhs": {"var": "params.declared_max_outflow_nano_ton"}
  }
}
```

### 9.4. Capability gate (compiled canonical form for `treasury.transfer`)

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "and",
    "args": [
      {
        "op": "or",
        "args": [
          {"op": "not", "arg": {"op": "requires_scope", "args": [{"action": "treasury.transfer"}, {"const": "treasury_access:transfer"}]}},
          {"op": "eq",
           "lhs": {"var": "capability.treasury_access_level"},
           "rhs": {"const": "transfer"}}
        ]
      },
      {
        "op": "or",
        "args": [
          {"op": "not", "arg": {"op": "is_owner_required", "args": [{"action": "treasury.transfer"}]}},
          {"op": "eq",
           "lhs": {"var": "signatures.owner_sig_valid"},
           "rhs": {"const": true}}
        ]
      }
    ]
  }
}
```

### 9.5. Precondition referencing only `state.*` (no bracket)

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "and",
    "args": [
      {"op": "gte",
       "lhs": {"var": "state.ptra.balances.0:83dfd552..."},
       "rhs": {"const": 100000000}},
      {"op": "eq",
       "lhs": {"var": "state.registry.agents.0:83dfd552....frozen_until"},
       "rhs": {"const": 0}}
    ]
  }
}
```

### 9.6. Forbidden: bracketed state in precondition

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "gte",
    "lhs": {"var": "state.after.ptra.balances.0:83dfd552..."},
    "rhs": {"const": 0}
  }
}
```

→ `PARSE_ERROR / BRACKETED_STATE_OUT_OF_SCOPE`. `state.after` is undefined at precondition time.

### 9.7. Forbidden: capability variable in invariant

```json
{
  "dsl_version": "1.2",
  "expr": {
    "op": "eq",
    "lhs": {"var": "capability.asset_scope.ptra_stake"},
    "rhs": {"const": true}
  }
}
```

→ `PARSE_ERROR / GATE_VAR_OUT_OF_SCOPE`. `capability.*` is gate-only.

### 9.8. Emergency invariant trace (injected by runtime in Bounded Mode)

A CAL submitted with `invariants: []` in Bounded Mode is evaluated as if it declared:

```json
"invariants": [
  {"op": "gte",
   "lhs": {"var": "state.after.treasury.developer_fund_balance"},
   "rhs": {"var": "state.before.treasury.developer_fund_balance"}},
  {"op": "gte",
   "lhs": {"var": "state.after.treasury.nav"},
   "rhs": {"op": "sub",
           "lhs": {"var": "state.before.treasury.nav"},
           "rhs": {"const": 0}}},
  {"op": "eq",
   "lhs": {"var": "state.after.failure_mode.is_bounded_mode"},
   "rhs": {"const": true}}
]
```

These do not appear in `CAL_HASH` but do count toward the gas budget at the standard invariant cost (5 + DSL ops).

---

## 10. License

This specification and all reference implementations of DSL v1.2 are released under the **MIT license** (see `LICENSE` in `paradigm_terra/promt/`). License terms align with Canonical Encoding §12, Constraint DSL v1.1 §10, CAL Execution Spec §15, and Constitution §16.1.

---

**Draft date:** 2026-05-23
**Next step:** Tier 3 ratification together with Constitution v0.10.0; addition of `PARADIGM_TERRA_DSL_V1.2` to Canonical Encoding §7.1 domain-tag registry as a Tier 2 amendment.
