# spec/vectors/ — language-neutral normative conformance vectors

```
spec/vectors/*
    language-neutral
    implementation-neutral
    normative-only
```

Vectors here are owned by a **normative contract**, not by any language or implementation.
TS, Rust, Go, the parity harness, and CI all consume the same files; none of them owns them.
The owner of `tc_v2_sig_verify_v1/` is the contract pair `TC_V2_SIGNDATA_VERIFY_V1` /
`TC_V2_TONPROOF_VERIFY_V1`.

## Two vector-ownership models in this repo (intentional, not duplication)

| Location | Owner | When to use |
|---|---|---|
| `<module>/vectors/golden.json` | the **language module** that authored it | a vector set produced and consumed by a single implementation (e.g. `canonical/`, `cal/`, `dsl/`) and ported outward |
| `spec/vectors/<contract>/` | the **contract** | a multi-implementation conformance package with no single language owner, where TS/Rust/Go must all be measured against the *same* neutral data |

These are not redundant. The per-module `golden.json` files belong to their module's language.
The `spec/vectors/` packages belong to a contract that several languages implement
independently. Do **not** migrate a `spec/vectors/` package into a language module — that would
hand contract-owned data to one implementation and re-introduce the very coupling the package
exists to prevent.

> Note: `spec/` (vectors) is distinct from `docs/spec/` (prose normative specifications). The
> prose contract for the package below lives at `docs/draft/tc-v2-sig-verify-v1-draft.md`; its
> boundary fuse at `docs/spec/tc-v2-contract-boundaries.md`.

## Packages

### `tc_v2_sig_verify_v1/`  (status: PRE-NORMATIVE)

Golden vectors for the two TC v2 owner-signature contracts. Two measurement axes, kept
deliberately separate so a verify-less implementation can still participate:

- **digest** — `expect.digest_sha256_hex`. The sha256 commit each implementation must reproduce
  bit-identically. When `digest_from_input: true` (all but the construction-override negatives),
  it is recomputable from the contract + `input`.
- **verdict** — `expect.verdict`. Result of `ed25519_verify(digest, signature, operator_pubkey)`.
  Requires a crypto backend.

Reference + harness: `tools/tc-v2-verify/`. Source corpus: `interop/conformance/`.
Promotion PRE-NORMATIVE → NORMATIVE is gated on TS/Rust/Go cross-language digest parity.
