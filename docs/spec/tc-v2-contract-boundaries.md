# TC v2 owner-signature — contract boundaries (architectural fuse)

**This is not a technical document. It is a risk specification.**

It exists to survive the moment — after TS, Rust, and Go implementations all exist — when
someone reasonably wants to "remove the duplication" between the two TC v2 owner-signature
contracts. That refactor is exactly how `cross-channel`-class bugs are introduced. This file
is the standing prohibition against it.

## The two contracts are independent

| | Contract A | Contract B |
|---|---|---|
| name | `TC_V2_SIGNDATA_VERIFY_V1` | `TC_V2_TONPROOF_VERIFY_V1` |
| role | owner **signature** (`signData`) | owner **authentication** (`ton-proof-item-v2`) |
| length/timestamp endianness | **big-endian** | **little-endian** |
| type discriminator | `"txt"` / `"bin"` | none |
| envelope | `sha256(message)` | `sha256(0xFFFF ‖ "ton-connect" ‖ sha256(inner))` |

Full byte layouts: `docs/draft/tc-v2-sig-verify-v1-draft.md`. They agree only on the Ed25519
primitive and on using sha256 as a building block — nowhere else.

## FORBIDDEN

Across every implementation (TS / Rust / Go) and the eventual validator integration:

```
FORBIDDEN:
  shared serializers          — no common message-builder parameterised by contract
  shared endian helpers       — endianness is a per-contract CONSTANT, not a parameter;
                                do not write write_u32(value, endian) used by both
  shared hash pipelines       — the single- vs nested-sha256 envelope must not be unified
  shared verification facade  — no verify_ton_connect(...) / verifyTonConnectSignature(...)
                                that branches internally by type. Two named entry points only:
                                  verifyOwnerSignatureSignData(...)
                                  verifyOwnerSignatureTonProof(...)
```

Sharing the underlying Ed25519 verify and a plain `sha256(bytes)` primitive is fine — those
are standard, contract-agnostic primitives. What must never be shared is anything that encodes
a *contract decision*: field order, endianness, discriminator, or envelope shape.

## REQUIRED structure

```
<lang>/
  sign_data.*    # Contract A only — its own encode_domain_length / encode_timestamp
  ton_proof.*    # Contract B only — its own encode_domain_length / encode_timestamp
  mod / index    # explicit dispatch to two named entry points; NO universal verifier
```

Conscious duplication of `encode_domain_length` / `encode_timestamp` in both files is the
intended design — not technical debt. For a package this small it is far cheaper than the
accidental merge it prevents.

## ENFORCEMENT

- **Human:** this document.
- **Executable:** the `cross-channel/` golden vectors
  (`spec/vectors/tc_v2_sig_verify_v1/cross-channel/`) REQUIRE that a Contract A capture fails
  under Contract B's routine and vice-versa. Any merge that makes the two routines converge
  will make a cross-channel vector pass-when-it-should-fail, and the parity harness goes red.

If you are reading this because you were about to unify the two paths: don't. Read the
cross-channel vectors first.
