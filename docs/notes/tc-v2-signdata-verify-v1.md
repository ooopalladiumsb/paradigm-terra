# `TC_V2_SIGNDATA_VERIFY_V1` — post-quiet normative work package (DRAFT scope note)

**Status:** Work-item scope note. **NOT normative. NOT a spec PR.** Created during the
PFC-1 quiet period to durably capture a candidate normative artifact whose byte layout is
now empirically reconstructed, so the eventual integration is a complete package rather than
a partial normative lock-in. Spec wins during quiet period; nothing here changes consensus.

**Anchor `z3h0ix`:** interop OBSERVES, PFC-1 DEFINES. This note records *what must be built
post-quiet* and *what evidence already exists* — it does not build it.

---

## 1. Why this exists

Divergence **D1** (matrix §10) is classified `A — TC_V2_COMMIT_MODEL`: TC v2 wallets do not
sign raw `payload.bytes`; they sign a structured commit. The exact bytes of **both** owner-sig
crypto channels are now reconstructed and ed25519-verified against real captures:

- **signData** (binary/text owner-sig channel) — matrix §10.2, repro `interop/tc-v2-commit-reconstruct.mjs`,
  4/4 captures across 2 wallets (Tonkeeper 4.7.0, MyTonWallet 4.10.1) + 4 negative controls.
- **ton_proof** (operator_pubkey binding, PFC-1 §10.2 of `cal-validator-design.md`) — matrix §3.1,
  repro `interop/ton-proof-verify.mjs`, 1 capture (MyTonWallet 4.10.1) + 4 negative controls.

The research is therefore **complete**: the open question moved from "what does the wallet
sign?" to "port the verified routine into the consensus core with full parity." That port is
the package below, gated behind the quiet period because it is consensus-touching.

## 2. The two channels (verified byte layouts)

```
signData (type text|binary):
  message = 0xFFFF ‖ "ton-connect/sign-data/" ‖ int32_be(workchain) ‖ addr_hash[32]
          ‖ uint32_be(domain_len) ‖ domain ‖ uint64_be(timestamp)
          ‖ ("txt"|"bin") ‖ uint32_be(payload_len) ‖ payload
  verify  = ed25519_verify( sha256(message), sig, pubkey )
            text  → "txt", payload = utf8(text)
            binary→ "bin", payload = base64_decode(bytes)

ton_proof (ton-proof-item-v2):
  inner   = "ton-proof-item-v2/" ‖ int32_be(workchain) ‖ addr_hash[32]
          ‖ uint32_le(domain_len) ‖ domain ‖ uint64_le(timestamp) ‖ payload(literal nonce string)
  verify  = ed25519_verify( sha256(0xFFFF ‖ "ton-connect" ‖ sha256(inner)), sig, pubkey )
```

**Critical:** the two channels use DIFFERENT endianness (signData BE, ton_proof LE for
domain_len/timestamp) and DIFFERENT outer hashing (single vs double-sha256 with prefix). The
normative text MUST state each channel's layout separately; a shared helper that assumes one
convention is a bug. (Matrix §3.1 comparison table.)

## 3. Full package required for normative promotion (do NOT split)

Promoting this into the spec is only worthwhile as the complete set — a partial lock-in is
worse than none:

- [ ] **Golden vectors** — promote the captures (signData ×4, ton_proof ×1) from
      PRE-NORMATIVE to NORMATIVE per the golden-vector workflow. Each vector: inputs
      (pubkey, workchain, addr_hash, domain, timestamp, type, payload) + expected commit
      digest + expected verify result.
- [ ] **TS implementation** — `validator/` SignData/ton_proof verify routine (§8.1 of
      `cal-validator-design.md`).
- [ ] **Rust implementation** — `validator-rs/`.
- [ ] **Go implementation** — `cal-validator-go/`.
- [ ] **Cross-language parity tests** — byte-identical commit digest + identical verify
      verdict across TS/Rust/Go (same harness pattern as the existing CAL parity gates).
- [ ] **Negative vectors** — corrupted sig, timestamp off-by-one, domain mismatch, wrong
      pubkey, tampered payload, AND a cross-channel vector (signData bytes verified under the
      ton_proof routine MUST fail, and vice-versa) to lock in the §2 "do not share logic" point.
- [ ] **Explicit workchain-encoding statement** — pin `int32` byte order for the workchain
      field in BOTH channels, with the §4 caveat resolution (see below).
- [ ] **Spec wiring** — Exec-spec §8.3 + `cal-validator-design.md` §8.1/§10.2 reference
      `TC_V2_SIGNDATA_VERIFY_V1` as the canonical owner-sig verify; remove the stale
      "ed25519_verify(payload_bytes, sig, pubkey)" assumption (D1 resolution).

The captured signData + ton_proof responses (Tonkeeper `2026-05-30`, MyTonWallet `2026-05-31`)
are ready-made fixtures for the parity step.

## 4. Residual uncertainty — workchain ≠ 0 (documented, not blocking)

All captures (both channels) are workchain `0`, so `int32` BE vs LE of the workchain field is
**indistinguishable** from this corpus (both serialize to `0x00000000`).

- This is **not "untested-yet"** — it is likely **un-testable via normal wallets**: standard
  TON user wallets (Tonkeeper, MyTonWallet, etc.) deploy only in workchain 0; masterchain
  (`-1`) is for validators/system contracts, with no штатный dApp path to a `-1` user wallet.
- Endianness is nonetheless grounded: the ton-connect reference verifier
  (`demo-dapp-with-react-ui` → `src/server/services/sign-data-service.ts`) uses
  `writeInt32BE` — a canonical SDK source, not a guess. The `verifyTcV2SignData` /
  `verifyTonProof` routines pin BE accordingly.
- **Resolution:** treat as a documented residual backed by canonical SDK source. Do NOT block
  the package on obtaining a `wc=-1` capture. If one ever appears opportunistically, add it as
  a vector to close the cross-check empirically. The explicit workchain-encoding statement
  (§3) should cite the reference impl as its authority and note this residual.

## 5. References

- Verified layouts + evidence: `docs/notes/interoperability-matrix.md` §10.2 (signData), §3.1 (ton_proof)
- Repro tooling: `interop/tc-v2-commit-reconstruct.mjs`, `interop/ton-proof-verify.mjs`
- Validator integration target: `docs/notes/cal-validator-design.md` §8.1, §10.2
- Spec wiring target: `docs/spec/execution-spec-v1.md` §8.3
- Reference verifier: `ton-connect/demo-dapp-with-react-ui` → `src/server/services/sign-data-service.ts`
