# TC v2 owner-signature verification — DRAFT normative description

**Status:** DRAFT (normative-intent). Two independent verification contracts. Promotion to
frozen normative (`docs/spec/`) is gated on TS/Rust/Go cross-language parity (Stage 5) and
validator integration (Stage 6). Quiet period was consciously ended 2026-05-31 to open this
package.

**Scope.** Defines how an owner/operator Ed25519 signature obtained via TON Connect v2 is
verified. There are **two** such channels, and they are **separate contracts** — they share
neither serialization nor hashing. Implementations MUST NOT use one channel's routine, helper,
or byte-builder for the other.

**Provenance.** Both byte layouts were reconstructed from real wallet captures and confirmed by
`ed25519_verify` (Tonkeeper 4.7.0, MyTonWallet 4.10.1). See `interop/tc-v2-commit-reconstruct.mjs`,
`interop/ton-proof-verify.mjs`, matrix §10.2/§3.1. Reference impl: `tools/tc-v2-verify/`. Golden
vectors: `spec/vectors/tc_v2_sig_verify_v1/`.

---

## Contract A — `TC_V2_SIGNDATA_VERIFY_V1`

Owner **signature** channel (TON Connect `signData`, types `text` and `binary`).

```
message = 0xFFFF
        ‖ utf8("ton-connect/sign-data/")
        ‖ int32_be(workchain)
        ‖ address_hash[32]
        ‖ uint32_be(domain_len) ‖ utf8(domain)
        ‖ uint64_be(timestamp)
        ‖ type_tag                         # "txt" (text) | "bin" (binary), 3 bytes
        ‖ uint32_be(payload_len) ‖ payload
digest  = sha256(message)
ACCEPT iff ed25519_verify(digest, signature, operator_pubkey)
```

- `payload` = `utf8(text)` for `text`; `base64_decode(bytes)` for `binary`.
- `text` is signed as opaque UTF-8 — wallets do NOT NFC-normalize (matrix §7); any text owner-sig
  must be NFC-normalized **upstream**. PFC-1 prefers `binary` (pre-canonicalized) for this reason.
- Endianness: **big-endian** for `domain_len`, `timestamp`, `payload_len`, `workchain`.
- Envelope: **single** sha256.

## Contract B — `TC_V2_TONPROOF_VERIFY_V1`

Owner **authentication** channel (`ton-proof-item-v2`). Binds `operator_pubkey` per
`cal-validator-design.md` §10.2.

```
inner   = utf8("ton-proof-item-v2/")
        ‖ int32_be(workchain)
        ‖ address_hash[32]
        ‖ uint32_le(domain_len) ‖ utf8(domain)
        ‖ uint64_le(timestamp)
        ‖ payload                          # the dApp nonce, as its LITERAL string bytes
outer   = 0xFFFF ‖ utf8("ton-connect") ‖ sha256(inner)
digest  = sha256(outer)
ACCEPT iff ed25519_verify(digest, signature, operator_pubkey)
```

- `payload` is the proof nonce signed as its **literal** (base64) string bytes — NOT decoded.
- Endianness: **little-endian** for `domain_len`, `timestamp`.
- Envelope: **nested** sha256 with an `0xFFFF ‖ "ton-connect"` prefix.

---

## The two contracts are NOT interchangeable

| | Contract A (signData) | Contract B (ton_proof) |
|---|---|---|
| schema prefix | `ton-connect/sign-data/` | `ton-proof-item-v2/` |
| `domain_len` / `timestamp` | **big-endian** | **little-endian** |
| type discriminator | `txt` / `bin` | none |
| payload | text→utf8, binary→base64-decoded | literal nonce string |
| envelope | `sha256(message)` | `sha256(0xFFFF ‖ "ton-connect" ‖ sha256(inner))` |

**Normative requirement.** A verifier MUST expose two distinct entry points
(`verifyOwnerSignatureSignData`, `verifyOwnerSignatureTonProof`) and MUST NOT route through a
single shared serializer. Conformance: the `cross-channel/` golden vectors REQUIRE that a Contract
A capture fails under Contract B's routine and vice-versa. This guards against the most likely
integrator regression: reusing the signData helper for ton_proof, which passes a subset of tests
and then breaks on real proofs.

## Workchain encoding (documented residual)

All captures are workchain `0`, so `int32` BE vs LE of the workchain field is empirically
indistinguishable (both serialize to `0x00000000`) and likely un-testable via normal wallets
(user wallets live in workchain 0). BE is pinned per the ton-connect reference verifier
(`demo-dapp-with-react-ui/src/server/services/sign-data-service.ts`, `writeInt32BE`). The frozen
spec MUST state BE explicitly and cite that authority. Full framing:
`docs/notes/tc-v2-signdata-verify-v1.md` §4.

## Promotion checklist (to frozen normative)

- [x] Byte layouts reconstructed + ed25519-verified (both contracts)
- [x] PRE-NORMATIVE corpus frozen (`interop/conformance/`)
- [x] Golden vectors: positive + negative + cross-channel (`spec/vectors/tc_v2_sig_verify_v1/`)
- [x] TS reference implementation (`tools/tc-v2-verify/`) — digest 14/14 + verdict 15/15
- [x] Rust implementation (`tc-v2-verify-rs/`) — digest 14/14 (digest-only by design)
- [x] Go implementation (`tc-v2-verify-go/`) — digest 14/14 + verdict 15/15 (2nd ed25519 oracle)
- [x] Cross-language parity harness (`tools/parity/tc-v2/run.sh`) — TS == Rust == Go digests; TS & Go verdicts
- [x] Validator integration (`cal-validator-design.md` §8.1) — node-side verifier produces the
      trace booleans; `validate()` stays pure. TS (`validator/src/owner-sig.ts`) + Go
      (`cal-validator-go/owner_sig.go`); Rust validator deferred-by-constraint (no Ed25519). Two
      distinct entry points; no universal facade.
- [ ] Formalize the CAL co-signature ingress envelope type (carries sig + wallet-echoed address/domain/timestamp)
- [ ] Exec-spec §8.3 wiring; remove the stale `ed25519_verify(payload_bytes, …)` assumption (D1)
- [x] **Contract B corroboration** — 2nd `ton_proof` capture landed (Tonkeeper 4.7.0, ed25519-verified); Contract B now at 2 captures / 2 wallets, meeting the same ≥2-wallet bar used for D1
- [ ] Promote vectors PRE-NORMATIVE → NORMATIVE; move this doc to `docs/spec/`
