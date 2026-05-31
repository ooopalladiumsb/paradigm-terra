# Session notes — 2026-05-31 — Tonkeeper ton_proof capture (Contract B 2nd wallet)

**Status:** Targeted capture to close the Contract B (`TC_V2_TONPROOF_VERIFY_V1`) ≥2-wallet
promotion gate. Fixes the 2026-05-30 gap where Tonkeeper's `ton_proof` **signature** and
**public key** were not recorded. This session records both. **Verified PASS** against the
reconstructed `ton-proof-item-v2` commit (`node interop/verify-tonproof-capture.mjs`).

**Setup**
- Wallet: Tonkeeper 4.7.0, browser extension, testnet (`account_chain: "-3"`).
- dApp: live GitHub Pages `https://ooopalladiumsb.github.io/paradigm-terra/` (domain 24 bytes ASCII).
- TonConnect UI `@tonconnect/ui@2.4.4`. Session `87b8c50c-…`, fresh modal-flow Connect.

## ton_proof (Phase 3) — the deliverable

Captured on connect (`ton_proof_received`), nonce matches the dApp's `connect_request.ton_proof_payload_b64`:

```json
{
  "timestamp": 1780255041,
  "domain": { "lengthBytes": 24, "value": "ooopalladiumsb.github.io" },
  "payload": "zj/ZLU5gV1qu6dY0koYXT8ZE9i8E5hKbjS0tcTQ0TDw=",
  "signature": "McDorUfGbB3hye3IPxYhSaD8J1ly/IGHmZnZRSEMwJYMmVCZL6ZIyLpAdhTeJ3wl+4NUywQC5xwwG+rIae5/BQ=="
}
```

- `wallet.account.public_key_hex` = `e4bd70ac7328e5cb46b79227ca972a421ff5261e1a0068ca16cd8e7c8768c48a`
  (**same key as the 2026-05-30 Tonkeeper signData captures** → Tonkeeper now covered on both channels).
- `account_address_raw` = `0:28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8` (workchain 0).
- `signature` base64 → 64 bytes Ed25519. `payload` is the literal base64 nonce string (NOT decoded).

## Result

`ed25519_verify(ton-proof-item-v2 commit, signature, public_key)` → **PASS**. Tonkeeper produces
the **same Contract B commit** (LE length/timestamp, nested `sha256(0xFFFF ‖ "ton-connect" ‖
sha256(inner))`) as MyTonWallet 4.10.1. → Contract B is a property of the TON Connect v2 signing
model, not wallet-specific; the ≥2-wallet bar (same as D1 / Contract A) is met.

Corpus: `interop/conformance/tonProof/tonkeeper-proof.json`. Added to golden vectors
`spec/vectors/tc_v2_sig_verify_v1/positive/tonkeeper-tonproof.json`.

## Also in this session (not gate-relevant, recorded for completeness)
- signData/binary on the gh-pages domain (bytes `interop-observation-sample`, ts 1780255306,
  sig `JIwg…HtDQ==`) — a fresh Contract A datapoint; Contract A already at 4 captures / 2 wallets,
  so not added to vectors.
- sendTransaction self-send (1 nTON) returned a BOC — transport happy-path, unrelated to owner-sig.
