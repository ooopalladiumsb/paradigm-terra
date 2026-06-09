# tc-v2-verify-go — Go port of TC_V2_SIGNDATA_VERIFY_V1 (digest + verdict)

Third independent implementation of the two TC v2 owner-signature contracts, written from
the normative draft (`docs/spec/tc-v2-sig-verify-v1.md`) — not ported from TS or Rust.
Three implementations agreeing on the vectors is evidence the draft itself is unambiguous.

## Scope: both axes

Unlike the Rust port (digest only), Go covers **digest and verdict** using the standard
library — `crypto/sha256`, `crypto/ed25519`, `encoding/json` — with `CGO_ENABLED=0`, no
external dependencies. Go's pure-Go `crypto/ed25519` is the **second independent verdict
oracle** after TS (Node/OpenSSL).

## Layout (mirrors the contract boundaries)

| File | Contract |
|---|---|
| `sign_data.go` | A — `TC_V2_SIGNDATA_VERIFY_V1` (BE; `txt`/`bin`; single sha256) |
| `ton_proof.go` | B — `TC_V2_TONPROOF_VERIFY_V1` (LE; nested sha256) |
| `verify.go` | two named entry points `VerifySignData` / `VerifyTonProof` — no `VerifyTonConnect` facade |

Each contract file owns its `encode*` helpers — deliberately duplicated, never shared
(`docs/spec/tc-v2-contract-boundaries.md`).

## Test

```
CGO_ENABLED=0 go test ./...
```

`vectors_test.go`: reads `../spec/vectors/tc_v2_sig_verify_v1/` and asserts digest parity
(14/14 `digest_from_input`) + verdict (15/15, full independent chain: Go digest + Go ed25519),
with per-verifier counts signData=13 / tonProof=2.
