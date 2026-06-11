# PFC2-M1 — Semantic Design: static M-of-N multisig (AuthorizationSet v2)

**Date:** 2026-06-11 · **Status:** semantic design (NO core code). PFC-2 line. Defines the
authorization-model change **before** any Freeze-Surface code. Ratifying this doc (merge) fixes the
decisions the later stages (PFC2-M2 validator → M3 reducer → M4 gas → M5 vectors → M6/M7 references →
M8 PP#4 → freeze) implement. Follows `pfc2-multisig-charter.md` (PFC2-M0). **Out of scope:** owner
rotation, weighted/hierarchical multisig, any operator-model change (charter §4).

These rulings are **normative design decisions** — the stages below implement them, they do not re-open
them. Each ruling cites the frozen code it generalizes.

## 0. What changes, in one line

The **owner-authorization predicate** over the existing `OWNER_REQUIRED_ACTIONS` set generalizes from
*"exactly one valid `owner_sig` from the agent's single `owner_pubkey`"* to *"at least `threshold` valid
`owner_sig`s from distinct members of the agent's `owners[]`"*. No verb is added or removed; the operator
path is untouched.

## 1. AuthorizationSet v2

### 1.1 Registry (per-agent owner record)

Frozen v1 (`validator/src/validate.ts:194` reads `registry.agents.<a>.owner_pubkey`):

```
owner_pubkey: string            // one hex Ed25519 pubkey ("" ⇒ no owner)
```

v2:

```
owners:    string[]             // hex Ed25519 pubkeys, SORTED ascending by raw pubkey bytes, DISTINCT
threshold: int                  // 1 ≤ threshold ≤ owners.length
```

**Bounds (RULING):** `1 ≤ owners.length ≤ MAX_OWNERS`, `MAX_OWNERS = 16`; `1 ≤ threshold ≤ owners.length`.
A `[]`/`threshold:0` owner record means *no owner* (the v1 `owner_pubkey: ""` case) — such an agent fails
any `OWNER_REQUIRED_ACTIONS` exactly as today. Bounds are enforced at the **reducer** (`agent.register` /
`agent.migrate`), NOT the validator — a malformed registry is a state-construction error, not a per-CAL
authorization verdict. The validator may *assume* a well-formed `owners`/`threshold` from the snapshot.

### 1.2 Signed-CAL owner co-signatures

Frozen v1 (`cal/src/schema.ts:98-113`): `signatures.owner_sig` is a **single** value with two accepted
forms in the §8.4 dual-accept window — legacy raw-hex Ed25519, OR a TON-Connect `OwnerCoSignature`
envelope (`{signature, address_hash, domain, workchain, ...}`, a Contract A commit by a human wallet,
verified by `ownerSigPresent(env, ownerPubkeyHex)` in `validator/src/owner-sig.ts:186`).

v2: `signatures.owner_sigs` is an **array** of `OwnerCoSignature` envelopes:

```
owner_sigs: OwnerCoSignature[]  // each the SAME envelope shape as today's owner_sig (TC v2, Contract A)
```

- **Ordering (RULING):** ascending by the **owner pubkey each envelope verifies against** (raw pubkey
  bytes, lexicographic). This makes canonicalization unambiguous — see §3.
- **No duplicate signers (RULING):** two envelopes that verify against the *same* `owners[j]` ⇒
  `INVALID_SIGNATURE_SET`. We do NOT silently dedupe inside the consensus path (a hidden dedupe would let
  one key count twice under a different envelope).
- **Cardinality:** `1 ≤ owner_sigs.length ≤ owners.length`. More envelopes than owners, or any envelope
  matching no member of `owners`, ⇒ `INVALID_SIGNATURE_SET`.

The single `owner_sig` key is **retired** on the PFC-2 line: a v1 single-owner CAL is migrated to a
one-element `owner_sigs` (§4). (Whether to keep a v2-side dual-accept for `owner_sig` is a migration-window
question deferred to M3; the *consensus form* is `owner_sigs[]`.)

### 1.3 Execution trace

Frozen v1 (`validator/src/trace.ts:43`): `ownerSigPresent: boolean` — the node's single-key verdict.

v2: `ownerSigners: string[]` — the node's set of **distinct owner pubkeys** for which a presented
`owner_sigs[]` envelope verified (⊆ `owners`). The node computes it by running the existing
`ownerSigPresent(env_i, owners[j])` check per envelope; `validate()` stays **pure** over `ownerSigners`
(it counts and threshold-compares, it does not verify signatures). `operatorSigPresent` is **unchanged**.

## 2. Validation algorithm (the §8.2 gate, generalized)

Replaces `validator/src/validate.ts:191-195`. For `action ∈ OWNER_REQUIRED_ACTIONS` (or bounded-mode):

```
ownerRequired = isOwnerRequired(action) || boundedMode
if ownerRequired:
    owners    = snapshot.registry.agents[agent].owners        // assume well-formed (reducer-enforced)
    threshold = snapshot.registry.agents[agent].threshold
    if owners is empty:               return spamFail(CAPABILITY_DENIED, "agent has no owners")

    # structural checks over the presented set (pre-quorum; these are INVALID_SIGNATURE_SET):
    if owner_sigs not sorted-ascending-by-matched-pubkey  → spamFail(INVALID_SIGNATURE_SET, "unsorted")
    if owner_sigs has a duplicate matched signer          → spamFail(INVALID_SIGNATURE_SET, "duplicate signer")
    if any envelope matches no member of owners           → spamFail(INVALID_SIGNATURE_SET, "non-owner signer")
    if owner_sigs.length > owners.length                  → spamFail(INVALID_SIGNATURE_SET, "cardinality")

    # quorum check (pure over the trace verdict set):
    validSigners = trace.ownerSigners                     # ⊆ owners, distinct, node-verified
    if validSigners.length < threshold:
        return spamFail(QUORUM_NOT_MET, "got {validSigners.length}/{threshold} owner signatures")
# operator gate UNCHANGED, runs first:
if not trace.operatorSigPresent:      return spamFail(CAPABILITY_DENIED, "operator_sig required")
```

**Ordering of failure classes (RULING):** `INVALID_SIGNATURE_SET` (the set is malformed — unsorted,
duplicate, non-owner, over-cardinality) is checked **before** `QUORUM_NOT_MET` (the set is well-formed but
too small). A malformed set never reports as "insufficient quorum" — the diagnostics stay distinct.

**1-of-1 degeneracy:** `owners=[k]`, `threshold=1`, `owner_sigs=[env_k]` ⇒ `validSigners=[k]`,
`1 ≥ 1` ⇒ pass — the v1 outcome. Behaviour identical; only the encoded shape differs.

## 3. Canonicalization rule

The hashed canonical form (the bytes the freeze surface covers) gains:
- `registry.agents.<a>.owners` — JSON array of hex strings, **stored sorted ascending by raw pubkey
  bytes**; `threshold` an integer. (Canonical JCS already sorts object keys; array element order is
  *semantic* here, hence the explicit sort rule.)
- `signatures.owner_sigs` — JSON array of `OwnerCoSignature` objects, **ordered ascending by the matched
  owner pubkey**. Each object canonicalizes exactly as today's single `owner_sig` envelope.

Determinism follows from: (a) `owners` sorted ⇒ one canonical registry encoding; (b) `owner_sigs` sorted
by matched pubkey + no duplicates ⇒ one canonical signature encoding for any given signer subset. Two
nodes presented the same logical authorization produce byte-identical canonical bytes ⇒ identical hashes ⇒
parity across TS/Rust/Go (the M5 vectors prove this).

## 4. Migration note (v1 → v2, the 1-of-1 bridge)

A frozen v1 snapshot/CAL maps deterministically:

```
registry:  owner_pubkey: K        →  owners: [K], threshold: 1          (K == "" → owners: [], threshold: 0)
signed CAL: owner_sig: env_K      →  owner_sigs: [env_K]
```

**SC-4 (charter §6) — behaviour invariance:** every v1 agent, migrated by this rule, must reach the
**identical terminal stage and event sequence** under v2. Only the *encoded values* (registry shape, signed
shape, and therefore hashes) change — which is precisely what makes this Tier C. The M3 reducer owns the
snapshot migration; M5 vectors include a migrated-1-of-1 case asserting behaviour-identity against the v1
golden.

## 5. Failure taxonomy additions

Two new reasons on the PFC-2 line (both spam-charged like the existing `CAPABILITY_DENIED` owner-gate
failures — §9.4 Tier-2; a presented-but-bad authorization set is not free):

| Reason | Meaning | vs existing |
|---|---|---|
| **`QUORUM_NOT_MET`** | the owner-signature set is well-formed but `validSigners < threshold` | NOT `CAPABILITY_DENIED` — the agent *has* the capability/scope; it simply lacks enough owner approvals. Distinct code ⇒ cleaner telemetry, alerting, and PP#4 evidence. |
| **`INVALID_SIGNATURE_SET`** | the set is malformed: unsorted, duplicate signer, non-owner signer, or cardinality > owners | NOT `QUORUM_NOT_MET` and NOT `BAD_SIG_BYTES` — the individual envelopes may be byte-valid; the *set* violates the v2 structural contract. |

`CAPABILITY_DENIED` retains its v1 meaning (no operator_sig, no owners on the agent, missing
capability/scope). `BAD_SIG_BYTES` / `BAD_OWNER_ENVELOPE` (`cal/src/schema.ts`) retain their per-envelope
meaning (one envelope is malformed at the schema layer, before the set is assembled).

## 6. PP#4 scope (RULING)

PP#4 proves the **authorization envelope and consensus behaviour**, NOT an on-chain multisig wallet. TON
wallet contracts (W5) are single-key; PFC-2 changes CAL / validator / reducer / gas — the *who-authorizes*
layer — not the external wallet contract. So PP#4 demonstrates, on testnet: a CAL authorized by a quorum
of distinct owner co-signatures **finalizes**, and a sub-threshold CAL is **rejected** (`QUORUM_NOT_MET`),
with the on-chain effect still published via the operator's existing W5 path. An on-chain multisig wallet
contract would be a much larger scope (PFC-3 candidate), explicitly out here.

## 7. Operator model (RULING)

**Unchanged.** Exactly one `operator_sig` (raw Ed25519 over canonical CAL bytes, agent runtime —
`validator/src/owner-sig.ts:151`) is still required and verified first. Multisig is **owner-side only**.
This is the primary blast-radius fence (charter SC-6): no non-owner-gated path and no operator path changes
its behaviour or its bytes.

## 8. What the later stages inherit (acceptance handoff)

```
M2 validator : implement §2 gate; emit QUORUM_NOT_MET / INVALID_SIGNATURE_SET per §5; pure over ownerSigners
M3 reducer   : owners[]/threshold registry state + §1.1 bounds + §4 v1→1-of-1 migration; SC-4 behaviour-identity
M4 gas       : per-signature owner-verification weight (k Ed25519 checks); operator weight unchanged
M5 vectors   : quorum-pass, QUORUM_NOT_MET, INVALID_SIGNATURE_SET (unsorted/dup/non-owner/cardinality),
               migrated-1-of-1 == v1 golden — promoted NORMATIVE, parity TS/Rust/Go
M6/M7        : TS + Go references green on M5 vectors (Rust rides the same vectors)
M8 PP#4      : §6 — quorum-authorized finalize + sub-threshold reject on testnet
freeze       : pfc2-consensus-freeze on the regenerated surface → v2.0.0
```

## 9. Related
- `pfc2-multisig-charter.md` (PFC2-M0) — the charter this designs the first increment of.
- `validator/src/validate.ts` §8.2 gate (`:191-195`), `validator/src/owner-sig.ts` (`ownerSigPresent`),
  `validator/src/trace.ts` (`ownerSigPresent` flag), `cal/src/schema.ts` (`owner_sig` dual form, §8.4) —
  the frozen surfaces §1/§2 generalize.
- `dsl/src/taxonomy.ts` `OWNER_REQUIRED_ACTIONS` — the unchanged action set the predicate ranges over.
- `tc-v2-verify-package` — the Contract A owner-envelope (TON Connect signData) each `owner_sigs[]` element is.
