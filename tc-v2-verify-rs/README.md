# tc-v2-verify-rs — Rust port of TC_V2_SIGNDATA_VERIFY_V1 (digest axis)

Rust implementation of the two TC v2 owner-signature contracts, derived from the
normative description (`docs/spec/tc-v2-sig-verify-v1.md`) and verified against
the same golden vectors as the TS reference.

## Scope: digest only (by design)

This crate computes the signed-message **digest** for each contract and proves it matches
the TypeScript reference byte-for-byte. It does **not** depend on Ed25519:

- The **digest** axis is ours (our byte layout) and is what must agree across TS/Rust/Go.
  It needs only sha256, which is vendored (`src/sha256.rs`) — no build scripts, no proc-macros,
  self-contained `x86_64-unknown-linux-musl` static build.
- The **verdict** axis (`ed25519_verify`) is a standard primitive. A pure-Rust, no-build-script
  Ed25519 is a separate vendoring effort and is intentionally off this crate's critical path;
  `validator-rs` already defers real Ed25519. The verdict axis is covered by TS (Node `crypto`)
  and Go (std `crypto/ed25519`) — two independent Ed25519 oracles agreeing on these digests.

## Layout (mirrors the contract boundaries)

| File | Contract |
|---|---|
| `src/sign_data.rs` | A — `TC_V2_SIGNDATA_VERIFY_V1` (BE; `txt`/`bin`; single sha256) |
| `src/ton_proof.rs` | B — `TC_V2_TONPROOF_VERIFY_V1` (LE; nested sha256) |
| `src/sha256.rs`, `src/util.rs` | shared contract-agnostic primitives (allowed) |

Each contract module owns its own `encode_*` field encoders — deliberately duplicated, never
shared. There is no universal serializer/verifier. See `docs/spec/tc-v2-contract-boundaries.md`.

## Test

```
cargo test            # uses .cargo/config.toml → musl + rust-lld
```

`tests/digest_parity.rs`: recomputes every `digest_from_input` golden vector (14/14) and asserts
byte-equality with the committed `digest_sha256_hex`.
