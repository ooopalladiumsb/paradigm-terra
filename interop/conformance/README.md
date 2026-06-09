# interop/conformance/ — PRE-NORMATIVE capture corpus

```
STATUS: PRE-NORMATIVE
DO NOT EDIT
SOURCE OF TRUTH FOR TC_V2_SIGNDATA_VERIFY_V1
```

Frozen raw captures of real TON Connect v2 owner-signature responses, transcribed
verbatim from the observation sessions. This directory is the **single source of
truth** from which the golden vector package (`spec/vectors/tc_v2_sig_verify_v1/`)
is derived. It separates *observation* (here) from the future *specification*
(golden vectors + normative description).

## Why frozen

Each file is a `(operator_pubkey, message inputs, signature)` triple produced by a
real wallet over a real Ed25519 key we do not hold. The captures cannot be
regenerated — losing or mutating them destroys the only ground truth. Treat as
append-only: new captures may be **added**; existing ones must **never** be edited.

## Contents

| File | Wallet | Channel | Notes |
|---|---|---|---|
| `signData/tonkeeper-binary.json` | Tonkeeper 4.7.0 | signData/binary | |
| `signData/tonkeeper-text.json` | Tonkeeper 4.7.0 | signData/text | text = opaque UTF-8 |
| `signData/mytonwallet-binary.json` | MyTonWallet 4.10.1 | signData/binary | |
| `signData/mytonwallet-text.json` | MyTonWallet 4.10.1 | signData/text | |
| `tonProof/mytonwallet-proof.json` | MyTonWallet 4.10.1 | tonProof | proof nonce = literal string |

All captures are **workchain 0** — see the documented workchain-endianness residual
in `docs/notes/tc-v2-signdata-verify-v1.md` §4.

## Two distinct contracts represented

- **Contract A — `TC_V2_SIGNDATA_VERIFY_V1`** (owner *signature*): `signData/*`
- **Contract B — `TC_V2_TONPROOF_VERIFY_V1`** (owner *authentication*): `tonProof/*`

They use different serialization (BE vs LE) and different hashing (single vs nested
sha256). See `docs/spec/tc-v2-sig-verify-v1.md`. A verifier must never share
serialization logic across the two.

## Verification

Cryptographic confirmation that these captures verify against the reconstructed
commits (the basis for promoting them to golden vectors):

```
node interop/tc-v2-commit-reconstruct.mjs   # Contract A, 4/4 captures
node interop/ton-proof-verify.mjs           # Contract B, 1 capture
node tools/tc-v2-verify/run-vectors.mjs     # full golden vector package
```
