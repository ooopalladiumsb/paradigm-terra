# tools/tc-v2-verify/ — TC v2 owner-signature reference implementation (TypeScript/JS)

Reference (Stage 4) implementation for the `TC_V2_SIGNDATA_VERIFY_V1` package. TS is
the reference language; Rust and Go ports must match it bit-for-bit on every vector
digest (Stage 5 parity, not yet built). Standalone — **not** wired into the validator
yet (Stage 6, gated on green parity).

## Modules

| File | Role |
|---|---|
| `sign-data.mjs` | Contract A — `TC_V2_SIGNDATA_VERIFY_V1` (signData; BE; `txt`/`bin`; single sha256) |
| `ton-proof.mjs` | Contract B — `TC_V2_TONPROOF_VERIFY_V1` (ton-proof-item-v2; LE; nested sha256) |
| `index.mjs` | Channel dispatcher — explicit per-contract entry points, **no universal verifier** |
| `gen-vectors.mjs` | Generates the golden vectors from the corpus; asserts crypto at generation |
| `run-vectors.mjs` | Independent re-check of the committed vectors (TS parity leg) |

**Design rule (enforced structurally):** Contract A and Contract B share no
serialization helper. They use different endianness and different hashing; a unified
helper is the integrator bug the cross-channel vectors exist to catch.

## Run

```
node tools/tc-v2-verify/gen-vectors.mjs   # regenerate spec/vectors/tc_v2_sig_verify_v1/
node tools/tc-v2-verify/run-vectors.mjs   # verify committed vectors (15/15 expected)
```

## References

- Normative contract description: `docs/draft/tc-v2-sig-verify-v1-draft.md`
- Capture corpus (source of truth): `interop/conformance/`
- Golden vectors: `spec/vectors/tc_v2_sig_verify_v1/`
- Work-item / package scope: `docs/notes/tc-v2-signdata-verify-v1.md`
- Empirical reconstruction (how the layouts were found): `interop/tc-v2-commit-reconstruct.mjs`, `interop/ton-proof-verify.mjs`
