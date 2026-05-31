# CAL co-signature envelope — DRAFT normative

**Status:** DRAFT (normative-intent). Defines how paradigm_terra binds a TON Connect v2
owner/operator signature to a CAL. Promotion to `docs/spec/` happens together with
`tc-v2-sig-verify-v1-draft.md` at the Stage-7 NORMATIVE promotion.

**Ownership.** Contracts A/B (`TC_V2_SIGNDATA_VERIFY_V1`, `TC_V2_TONPROOF_VERIFY_V1`) are TON
Connect v2 constructs we reconstructed and verified. The **CAL co-signature envelope** is
paradigm_terra's own construct: how the validator *uses* Contract A to authenticate a CAL.

**Decisions locked (rationale in §12):** `1A` domain not pinned at consensus · `2A` timestamp
reconstruction-only · `3A` identity = registry pubkey · `4A` `binary` only · `5A` independent
envelopes.

**This document defines the contract and its data requirements. It does NOT define the concrete
CAL representation** (where the fields physically live) — that is §8.3 wiring. Ordering:
`contract → envelope requirements → CAL representation → validator wiring`.

---

## 1. Purpose

A CAL is authorized by co-signatures: a required `operator_sig` and, for OWNER_REQUIRED_ACTIONS
and Bounded Mode (§10.4), an `owner_sig` (§8.1/§8.2). Per the D1 finding, a TON Connect v2 wallet
does not sign raw payload bytes; it signs a structured **Contract A** commit
(`TC_V2_SIGNDATA_VERIFY_V1`). The validator therefore cannot call
`ed25519_verify(payload_bytes, sig, pubkey)`; it must reconstruct the Contract A commit. This
document specifies exactly what the validator needs, where authority comes from, and — crucially
— which inputs must be agreed across nodes.

## 2. The envelope (abstract)

For each co-signer, a CAL co-signature envelope carries:

| Field | Meaning |
|---|---|
| `signature` | 64-byte Ed25519 signature (the Contract A commit signature) |
| `domain` | the origin string the wallet bound into the commit |
| `timestamp` | the wallet's signing timestamp bound into the commit |
| `address` / `workchain` | the signer's wallet address (workchain + 32-byte hash) bound into the commit |
| *(payload)* | NOT carried — it is `canonical_bytes(cal_without_signatures)`, derived from the CAL (§7) |

`signature`, `domain`, `timestamp`, `address`, `workchain` are **not derivable from the CAL**.
Only `payload` is. This asymmetry is the whole reason §5 exists.

## 3. SignData / Contract A binding

The co-signature is verified by reconstructing the **Contract A** commit
(`tc-v2-sig-verify-v1-draft.md`, big-endian, `"bin"` discriminator, single sha256) with:

```
payload  = canonical_bytes(cal_without_signatures)        # from the CAL
type     = "bin"                                           # §4A — MUST be binary
domain, timestamp, workchain, address_hash                # from the envelope
verify   = ed25519_verify( signDataDigest(...), signature, registry_pubkey )
```

**§4A (normative): CAL co-signatures MUST use TON Connect `signData`/`binary`.** A `text`-typed
co-signature MUST be rejected. (Binary signs pre-canonicalized bytes, sidestepping wallet
NFC-normalization — matrix §7; this closes the Unicode/NFC question.)

## 4. Decision Inputs vs Reconstruction Inputs

A field used to rebuild the signed commit is **not** the same as a field consensus uses to make
an authorization decision. Conflating them is the drift this section prevents
("not a decision input" must never be read as "unimportant / regenerable").

| Field | Consensus *Decision* Input | Consensus *Reconstruction* Input |
|---|---|---|
| `canonical_bytes` | Yes | Yes (via `CAL_HASH`) |
| registry `operator_pubkey` / `owner_pubkey` | Yes | Yes (from registry) |
| `domain` | **No** | **Yes** |
| `timestamp` | **No** | **Yes** |
| `address` | **No** | **Yes** |
| `workchain` | **No** | **Yes** |

A reconstruction input wrong by one byte makes `ed25519_verify` fail — so these fields are
**self-authenticating** (cannot be forged without breaking the signature). They are not
authorization, replay, freshness, or identity decision inputs.

## 5. Data availability requirement

> **Every field required for Contract A reconstruction MUST be carried as consensus-visible
> envelope data and MUST be identically available to all validators.**

`domain`, `timestamp`, `address`, `workchain` are not in `canonical_bytes(cal_without_signatures)`
and not covered by `CAL_HASH`. A node cannot *generate* them — it must *receive* them. If two
nodes reconstruct from different envelope bytes for the same CAL, their `operatorSigPresent`
verdicts diverge → consensus split. Security does not require these fields inside `CAL_HASH`
(tampering breaks the signature), but **determinism requires identical delivery**.

The **concrete representation** (which part of the CAL carries the envelope) is deferred to §8.3
wiring. This document fixes only the requirement, not the storage location.

## 6. Operator and owner co-signatures (§5A)

`operator_sig` (always required) and `owner_sig` (OWNER_REQUIRED_ACTIONS / Bounded Mode) are each
an independent Contract A commit over the same `canonical_bytes(cal_without_signatures)`, by
different signers (different key, address, and — being signed in separate wallet sessions —
generally different `timestamp`). Each envelope is **independently authenticated and independently
verified**. No cross-envelope equality of `timestamp` or `domain` is required.

## 7. Canonicalization

> `canonical_bytes(cal_without_signatures)` is the **sole** source of the signed payload bytes.

The signatures section is stripped before canonicalization (CE / canonical-encoding). Both
co-signers sign the identical payload bytes; only their key/address/domain/timestamp differ.

## 8. Connection-time binding (Contract B, ton_proof) — reference

Operator identity is bound at connection via `ton_proof` (**Contract B**,
`TC_V2_TONPROOF_VERIFY_V1`, §10.2): the returned pubkey MUST byte-match
`state.registry.agents[id].operator_pubkey`. This is an **ingress-layer** step
(`ton-connect-ingress-design.md` §5, out-of-consensus transport), and its `domain`-matches-origin
check is the same ingress origin-policy referenced by §1A below.

## 9. Validation flow

1. Ingress collects each co-signature envelope (out-of-consensus transport).
2. The node reconstructs the Contract A commit (§3) from the envelope + `canonical_bytes`.
3. `ed25519_verify(commit, signature, registry_pubkey)` → `operatorSigPresent` / `ownerSigPresent`
   (`validator/src/owner-sig.ts`, `cal-validator-go/owner_sig.go`).
4. The pure `validate()` consumes those booleans (§8.1/§8.2). Replay/expiration via `nonce` +
   `expiration_tick` (unchanged).

## 10. Relationship to the replay / expiration model (§2A)

> **Timestamp is reconstructed and verified as part of the signed commit, but does not participate
> in replay, freshness, expiration, or authorization decisions.**

Replay and expiration remain **exclusively** defined by `nonce` (§6.2) and `expiration_tick`
(§3.4; `valid_until = unix_ts_at_tick(expiration_tick)`, §8.3). The wallet `timestamp` is bound
into the commit because the wallet puts it there (D1); layering it as a second expiration axis
would add client-clock non-determinism and conflict with the existing model. It is therefore a
reconstruction input only (§4).

## 11. Security invariants

- **Identity (§3A):** the registry public key is the **sole** consensus identity anchor —
  `operator_pubkey` for `operator_sig`, `owner_pubkey` for `owner_sig`. The `address` in the
  commit is self-authenticating and is not a separate consensus check.
- **Integrity:** any change to `canonical_bytes`, `domain`, `timestamp`, `address`, or `workchain`
  breaks `ed25519_verify`.
- **Honest residual (§1A — origin not bound at consensus):**

  > Consensus does not bind co-signatures to a canonical origin. A valid co-signature obtained on
  > one origin may be relayed through another origin. This does **not** permit action substitution,
  > because `canonical_bytes`, `nonce`, and `expiration_tick` remain signed and verified. Origin
  > policy remains an ingress-layer responsibility.

  (Same disposition as the workchain-endianness residual: documented, bounded, not hidden.)

## 12. Forbidden transformations

- No `text`-typed CAL co-signature (§4A).
- No NFC/BOM/whitespace transformation of the payload (binary = pre-canonicalized bytes).
- No deriving authorization/replay/freshness from `domain` or `timestamp` (§1A/§2A).
- No node-local source for any reconstruction input (§5) — all must be consensus-visible.
- No shared serializer / endian / hash-pipeline / verification facade across Contracts A and B
  (`docs/spec/tc-v2-contract-boundaries.md`).

## 13. Consensus Surface Minimization (the architectural result)

> For `operator_sig` and `owner_sig`, validators reconstruct Contract A commits from
> consensus-visible envelope data and verify them against the corresponding registry public key.
> `domain`, `timestamp`, `address`, and `workchain` are reconstruction inputs but not
> authorization, replay, freshness, or identity decision inputs. Replay semantics remain
> exclusively defined by `nonce` and `expiration_tick`.

Net effect of `1A+2A+3A+4A+5A`: the envelope adds **exactly one** new consensus invariant —
*the Contract A commit reconstructs exactly and `ed25519_verify` passes against the registry key* —
and **zero** new rules for domain, timestamp, address, origin, freshness, or replay.

## 14. Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1A | `domain` not pinned at consensus; origin policy is ingress-layer | consensus decisions on `domain` would require `domain` to be consensus state; node-local pinning → split. Mirrors ton_proof domain-match living in ingress (§8). |
| 2A | `timestamp` reconstruction-only | CAL already has a complete deterministic replay model; wallet wall-clock adds non-determinism + a conflicting axis. |
| 3A | identity = registry pubkey only | already the §10.2 invariant; commit address is self-authenticating; binding wallet-address derivation adds a crypto/network layer for no authorization gain. |
| 4A | `binary` only | sidesteps wallet NFC-normalization (matrix §7); PFC-1's existing choice. |
| 5A | independent envelopes | operator/owner sign in separate sessions; equality requirements would be artificial. |

## 15. References

- Contracts: `docs/draft/tc-v2-sig-verify-v1-draft.md`; boundaries fuse `docs/spec/tc-v2-contract-boundaries.md`
- Verifiers: `validator/src/owner-sig.ts`, `cal-validator-go/owner_sig.go`, `tools/tc-v2-verify/`
- Vectors: `spec/vectors/tc_v2_sig_verify_v1/`
- Spec touchpoints (Stage 7): Exec-spec §8.3 (CAL representation + wiring), `cal-validator-design.md` §8.1/§8.2/§10.2
