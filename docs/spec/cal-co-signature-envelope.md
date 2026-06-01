# CAL co-signature envelope — NORMATIVE

**Status:** NORMATIVE (promoted 2026-06-01 with `tc-v2-sig-verify-v1.md`, Exec-spec §8.4 Tier-2
amendment). Defines how paradigm_terra binds CAL co-signatures, and in particular the **owner
co-signature envelope** for the TON Connect channel.

**Ownership.** Contracts A/B (`TC_V2_SIGNDATA_VERIFY_V1`, `TC_V2_TONPROOF_VERIFY_V1`) are TON
Connect v2 constructs we reconstructed and verified. The **owner co-signature envelope** is
paradigm_terra's own construct: how the validator *uses* Contract A to authenticate an `owner_sig`.

**Decisions locked (rationale in §14):** `1A` domain not pinned at consensus · `2A` timestamp
reconstruction-only · `3A` identity = registry pubkey · `4A` `binary` only · `5A` operator and
owner are independent (and use different mechanisms — see §0).

**This document defines the contract and its data requirements. It does NOT define the concrete
CAL representation** (where the fields physically live) — that is §8.3 wiring. Ordering:
`contract → envelope requirements → CAL representation → validator wiring`.

---

## 0. Two co-signatures, two different signing mechanisms (read first)

A CAL carries up to two co-signatures with **distinct origins** (Exec Spec §8.1: two key tiers).
They MUST NOT be unified — this separation is the whole point of this document.

| Signature | Signer | Mechanism | Reconstruction contract | Envelope |
|---|---|---|---|---|
| `operator_sig` (always required) | agent **runtime**, programmatically | **raw Ed25519** over `canonical_bytes(cal_without_signatures)` | **none** | **no** |
| `owner_sig` (conditional, §8.2 / §10.4) | human **wallet** via TON Connect | `signData`/`binary` (D1) | **Contract A** (`TC_V2_SIGNDATA_VERIFY_V1`) | **yes** |

> `operator_sig` is produced by the agent runtime with its local operator key — "no external
> ingress channel … not consensus" (Exec Spec §8.1/§8.3). It is a plain Ed25519 signature over
> the canonical CAL bytes: **no TON Connect, no Contract A, no envelope.** The historical
> raw-byte description in §8.3 is correct *for this channel*.

> `owner_sig` is produced by a TON Connect wallet, which (per D1) signs a structured **Contract A**
> commit — not raw bytes. This is the only channel where the envelope (below) applies, and the
> only place §8.3's raw-byte wording must change.

The rest of this document specifies the **owner** envelope. `operator_sig` appears only for
contrast and in the verification flow (§9).

## 1. Purpose

For `owner_sig`, a TON Connect v2 wallet does not sign raw payload bytes; it signs a structured
**Contract A** commit. The validator therefore cannot call
`ed25519_verify(payload_bytes, owner_sig, owner_pubkey)`; it must reconstruct the Contract A
commit. This document specifies what the validator needs to do so, where authority comes from,
and — crucially — which inputs must be agreed across nodes. (`operator_sig` keeps the raw verify;
no change.)

## 2. The owner envelope (abstract)

For the owner co-signer, the envelope carries:

| Field | Meaning |
|---|---|
| `signature` | 64-byte Ed25519 signature (the Contract A commit signature) |
| `domain` | the origin string the wallet bound into the commit |
| `timestamp` | the wallet's signing timestamp bound into the commit |
| `address` / `workchain` | the signer's wallet address (workchain + 32-byte hash) bound into the commit |
| *(payload)* | NOT carried — it is `canonical_bytes(cal_without_signatures)`, derived from the CAL (§7) |

`signature`, `domain`, `timestamp`, `address`, `workchain` are **not derivable from the CAL**.
Only `payload` is. This asymmetry is the whole reason §5 exists. (`operator_sig` has no envelope:
the agent signs the canonical bytes raw, so nothing beyond the signature itself is needed.)

## 3. Owner signData / Contract A binding

`owner_sig` is verified by reconstructing the **Contract A** commit
(`tc-v2-sig-verify-v1.md`, big-endian, `"bin"` discriminator, single sha256) with:

```
payload  = canonical_bytes(cal_without_signatures)        # from the CAL
type     = "bin"                                           # §4A — MUST be binary
domain, timestamp, workchain, address_hash                # from the envelope
verify   = ed25519_verify( signDataDigest(...), owner_sig, owner_pubkey )
```

**§4A (normative): owner co-signatures MUST use TON Connect `signData`/`binary`.** A `text`-typed
owner co-signature MUST be rejected. (Binary signs pre-canonicalized bytes, sidestepping wallet
NFC-normalization — matrix §7; this closes the Unicode/NFC question.)

## 4. Decision Inputs vs Reconstruction Inputs (owner channel)

A field used to rebuild the signed commit is **not** the same as a field consensus uses to make
an authorization decision. Conflating them is the drift this section prevents
("not a decision input" must never be read as "unimportant / regenerable").

| Field | Consensus *Decision* Input | Consensus *Reconstruction* Input |
|---|---|---|
| `canonical_bytes` | Yes | Yes (via `CAL_HASH`) |
| registry `owner_pubkey` | Yes | Yes (from registry) |
| `domain` | **No** | **Yes** |
| `timestamp` | **No** | **Yes** |
| `address` | **No** | **Yes** |
| `workchain` | **No** | **Yes** |

A reconstruction input wrong by one byte makes `ed25519_verify` fail — so these fields are
**self-authenticating** (cannot be forged without breaking the signature). They are not
authorization, replay, freshness, or identity decision inputs.

## 5. Data availability requirement (owner channel)

> **Every field required for Contract A reconstruction of `owner_sig` MUST be carried as
> consensus-visible envelope data and MUST be identically available to all validators.**

`domain`, `timestamp`, `address`, `workchain` are not in `canonical_bytes(cal_without_signatures)`
and not covered by `CAL_HASH`. A node cannot *generate* them — it must *receive* them. If two
nodes reconstruct from different envelope bytes for the same CAL, their `ownerSigPresent` verdicts
diverge → consensus split. Security does not require these fields inside `CAL_HASH` (tampering
breaks the signature), but **determinism requires identical delivery**.

The **concrete representation** (which part of the CAL carries the envelope) is deferred to §8.3
wiring. This document fixes only the requirement, not the storage location. (`operator_sig` needs
no such data beyond the signature bytes.)

## 6. Independence (§5A)

`operator_sig` (always required) and `owner_sig` (OWNER_REQUIRED_ACTIONS / Bounded Mode) are
**independent**: different keys, different signers, and — crucially — **different mechanisms**
(operator = raw Ed25519, owner = Contract A; §0). They are verified independently. There is no
cross-signature equality requirement, and the owner envelope does not apply to `operator_sig`.

## 7. Canonicalization

> `canonical_bytes(cal_without_signatures)` is the **sole** source of the signed payload bytes —
> for BOTH channels.

The signatures section is stripped before canonicalization (CE / canonical-encoding). The
operator signs these bytes raw; the owner signs a Contract A commit *over* these bytes. Same
bytes, different envelope.

## 8. Connection-time binding (Contract B, ton_proof) — reference

Operator identity is bound at connection via `ton_proof` (**Contract B**,
`TC_V2_TONPROOF_VERIFY_V1`, §10.2): the returned pubkey MUST byte-match
`state.registry.agents[id].operator_pubkey`. This is an **ingress-layer** step
(`ton-connect-ingress-design.md` §5, out-of-consensus transport), and its `domain`-matches-origin
check is the same ingress origin-policy referenced by §1A in §11.

## 9. Validation flow

```
operator channel                      owner channel (when required)
canonical_bytes(cal)                  canonical_bytes(cal) + envelope (domain/ts/address/wc)
        ↓                                     ↓
raw ed25519_verify(bytes,             Contract A reconstruct → ed25519_verify(commit,
   operator_sig, operator_pubkey)        owner_sig, owner_pubkey)
        ↓                                     ↓
operatorSigPresent                    ownerSigPresent
        └──────────────┬───────────────────────┘
                       ↓
                  validate()  (pure; consumes the two booleans; §8.1/§8.2)
```

Replay/expiration via `nonce` (§6.2) + `expiration_tick` (§3.4) — unchanged.
(`validator/src/owner-sig.ts`, `cal-validator-go/owner_sig.go`.)

## 10. Relationship to the replay / expiration model (§2A)

> **The owner `timestamp` is reconstructed and verified as part of the signed commit, but does not
> participate in replay, freshness, expiration, or authorization decisions.**

Replay and expiration remain **exclusively** defined by `nonce` (§6.2) and `expiration_tick`
(§3.4; `valid_until = unix_ts_at_tick(expiration_tick)`, §8.3). The wallet `timestamp` is bound
into the commit because the wallet puts it there (D1); layering it as a second expiration axis
would add client-clock non-determinism and conflict with the existing model. It is therefore a
reconstruction input only (§4).

## 10.1 Ingress derivation & test-invariant boundary (Option B)

The trace's signature-presence booleans are derived, not asserted:

> **`verifyIngress()` is the normative path by which `operatorSigPresent` and `ownerSigPresent`
> are derived from consensus-visible signature material carried in the CAL.**

It lifts the validator's pure-function principle one level up:
`CAL → verifyIngress() → {operatorSigPresent, ownerSigPresent} → ExecutionTrace → validate()`.
`validate()` and the reducer stay pure over the booleans; `verifyIngress()` does the Ed25519
work (operator raw / owner Contract A) before the trace is built. Ed25519-capable-runtime
concern: TS + Go; a Rust node is deferred-by-constraint (no no-build-script Ed25519, consistent
with `validator-rs`).

The test corpus is split accordingly:

> **Lifecycle golden vectors MAY inject the trace booleans directly. Their purpose is
> state-machine validation, not signature verification.**

The crypto-suite (real Ed25519 keys, real signatures, `verifyIngress` → … → `cal.finalized`)
verifies the signature path; the lifecycle-suite injects booleans to exercise the state machine.
They check **different invariants** and neither subsumes the other. Reference proof:
`orchestrator/test/ingress.test.ts`; verifier `orchestrator/src/ingress.ts`.

## 11. Security invariants

- **Identity (§3A):** the registry public key is the **sole** consensus identity anchor —
  `operator_pubkey` for `operator_sig`, `owner_pubkey` for `owner_sig`. The `address` in the owner
  commit is self-authenticating and is not a separate consensus check.
- **Integrity:** operator — any change to the canonical bytes breaks the raw verify; owner — any
  change to `canonical_bytes`, `domain`, `timestamp`, `address`, or `workchain` breaks
  `ed25519_verify`.
- **Channel non-interchangeability:** an `operator_sig` (raw) and an `owner_sig` (Contract A) are
  not interchangeable; a wallet Contract A signature does not pass the raw operator path and vice
  versa (enforced by `owner-sig` tests, mirroring the contract-layer cross-channel vectors).
- **Honest residual (§1A — owner origin not bound at consensus):**

  > Consensus does not bind the owner co-signature to a canonical origin. A valid `owner_sig`
  > obtained on one origin may be relayed through another origin. This does **not** permit action
  > substitution, because `canonical_bytes`, `nonce`, and `expiration_tick` remain signed and
  > verified. Origin policy remains an ingress-layer responsibility.

  (Same disposition as the workchain-endianness residual: documented, bounded, not hidden.)

## 12. Forbidden transformations

- No `text`-typed owner co-signature (§4A).
- No NFC/BOM/whitespace transformation of the payload (binary = pre-canonicalized bytes).
- No deriving authorization/replay/freshness from owner `domain` or `timestamp` (§1A/§2A).
- No node-local source for any owner reconstruction input (§5) — all must be consensus-visible.
- **No routing `operator_sig` through Contract A / the owner envelope** (§0) — operator is raw.
- No shared serializer / endian / hash-pipeline / verification facade across Contracts A and B
  (`docs/spec/tc-v2-contract-boundaries.md`).

## 13. Consensus Surface Minimization (the architectural result)

> `operator_sig` is verified as a raw Ed25519 signature over `canonical_bytes(cal_without_signatures)`
> against the registry `operator_pubkey`. `owner_sig` is verified by reconstructing the Contract A
> commit from consensus-visible envelope data and verifying it against the registry `owner_pubkey`.
> `domain`, `timestamp`, `address`, and `workchain` are reconstruction inputs but not
> authorization, replay, freshness, or identity decision inputs. Replay semantics remain
> exclusively defined by `nonce` and `expiration_tick`.

Net effect of `1A+2A+3A+4A+5A`: the owner channel adds **exactly one** new consensus invariant —
*the Contract A commit reconstructs exactly and `ed25519_verify` passes against the registry
owner key* — and the operator channel is **unchanged** (raw verify). **Zero** new rules for
domain, timestamp, address, origin, freshness, or replay.

## 14. Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1A | owner `domain` not pinned at consensus; origin policy is ingress-layer | consensus decisions on `domain` would require `domain` to be consensus state; node-local pinning → split. Mirrors ton_proof domain-match living in ingress (§8). |
| 2A | owner `timestamp` reconstruction-only | CAL already has a complete deterministic replay model; wallet wall-clock adds non-determinism + a conflicting axis. |
| 3A | identity = registry pubkey only | already the §10.2 invariant; commit address is self-authenticating; binding wallet-address derivation adds a crypto/network layer for no authorization gain. |
| 4A | owner `binary` only | sidesteps wallet NFC-normalization (matrix §7); PFC-1's existing choice. |
| 5A | operator/owner independent; **different mechanisms** | operator = raw Ed25519 (agent runtime, no wallet); owner = Contract A (wallet). Unifying them routes TON Connect semantics into a channel that never had them (§0). |

## 15. References

- Contracts: `docs/spec/tc-v2-sig-verify-v1.md`; boundaries fuse `docs/spec/tc-v2-contract-boundaries.md`
- Verifiers: `validator/src/owner-sig.ts`, `cal-validator-go/owner_sig.go`, `tools/tc-v2-verify/`
- Vectors: `spec/vectors/tc_v2_sig_verify_v1/`
- Signing model: `docs/draft/cal-execution-spec-v0.1.0-draft.md` §8.1 (two key tiers), §8.3
- Spec touchpoints (Stage 7): Exec-spec §8.3 (owner CAL representation + wiring), `cal-validator-design.md` §8.1/§8.2/§10.2
