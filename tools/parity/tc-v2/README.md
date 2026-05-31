# tools/parity/tc-v2/ — cross-language parity harness (Stage 5)

`run.sh` runs the TS, Rust, and Go implementations of `TC_V2_SIGNDATA_VERIFY_V1` against
the same committed golden vectors and requires all three green.

```
bash tools/parity/tc-v2/run.sh
```

## What "parity" means here

- **Digest (TS == Rust == Go).** Every suite asserts its computed digests are byte-identical
  to the committed `expect.digest_sha256_hex`. All three compare to the same canonical values,
  so green-across-three transitively proves the three implementations agree on every digest.
- **Verdict (TS & Go).** The `ed25519_verify` verdict is confirmed by two independent crypto
  engines — TS (Node/OpenSSL) and Go (pure-Go std `crypto/ed25519`). Rust is digest-only by
  design (no no-build-script Ed25519 in this environment; see `tc-v2-verify-rs/README.md`).

## Gate

Green here is the precondition for Stage 6 (validator integration). Do not wire the verify
routines into the validator while this is red.
