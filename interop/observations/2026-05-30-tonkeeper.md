# Session notes — 2026-05-30 — Tonkeeper testnet observation (partial)

**Status:** partial session. Phases 2, 3, 4a, 5, 6, 10 covered. Phases 7, 8, 9, 11, 12 deferred. Two material PFC-1 divergences captured.

**Setup**

- Branch: `post-pfc1/interop-smoke`
- dApp: `interop/dapp/index.html`, served via `python3 -m http.server 5173`
- TonConnect UI: bumped `2.1.0 → 2.4.4` during session (2.1.0 did not export `signData`)
- Public reach: ssh reverse tunnels (cloudflared blocked at port 7844 in this env)
  - localhost.run × 3 — flaky, ~10–30 min uptime per attempt
  - pinggy × 2 — same pattern, 60-min free-tier cap
  - Each tunnel restart requires `manifest.json.url` edit + full reconnect

## Wallet under test

| Field | Value |
|---|---|
| Name | tonkeeper |
| Version | 4.7.0 |
| Form factor | Chrome browser extension |
| Account address | `0:28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8` |
| Pubkey (raw32 hex) | `e4bd70ac7328e5cb46b79227ca972a421ff5261e1a0068ca16cd8e7c8768c48a` |
| Network | `-3` (testnet — confirmed in Phase 4a response `payload.network`) |
| Advertised features | `SendTransaction` (legacy string), `{name:"SendTransaction", maxMessages:255, extraCurrencySupported:true}`, `{name:"SignData", types:["text","binary","cell"]}` |
| `SignMessage` in features | **absent** |

## Phase coverage

### Phase 2 — Connect
Captured. See wallet table above.

### Phase 3 — ton_proof
Captured 4× across 3 different domains:

| # | Domain | `lengthBytes` | timestamp (UTC) | Notes |
|---|---|---|---|---|
| 1 | a9830d0eb09089.lhr.life | 23 | 2026-05-30T07:42:10Z | initial |
| 2 | a9830d0eb09089.lhr.life | 23 | 2026-05-30T07:56:54Z | reconnect after disconnect |
| 3 | 10076c73b909ca.lhr.life | 23 | 2026-05-30T08:07:01Z | new tunnel |
| 4 | srjjv-92-118-205-41.run.pinggy-free.link | 40 | 2026-05-30T08:37:31Z | pinggy domain |

- Wallet returns fresh nonce, fresh sig, fresh timestamp on every fresh `Connect` (modal flow).
- Domain `lengthBytes` matches char count for ASCII domains. **IDN case still untested.**
- payload echo is verbatim base64 of the 32-byte random nonce dApp generates.

### Phase 4a — `signData` / `binary`

Captured. Full response:

```json
{
  "signature": "cRTFbHRLOkfKOnd66XpBMa5j2ZOK6/etlgy+WJz8PDL4ddhXtFNQjDE6LahkhIE4nfd924FNEBxaiBaWfHsaDA==",
  "address": "0:28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8",
  "timestamp": 1780128533,
  "domain": "10076c73b909ca.lhr.life",
  "payload": {
    "network": "-3",
    "from": "0:28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8",
    "type": "binary",
    "bytes": "WyJhZ2VudGljX2NhbmNlbF9yb290X3dhbGxldF9zZXR1cCJd"
  },
  "traceId": "019e77ed-d202-7748-8337-f63ac4dd75b0"
}
```

- `signature`: base64 → 64 bytes Ed25519. Encoding is base64, **not** hex.
- Response includes `timestamp` + `domain` as top-level fields → strong signal these are part of the signed commit.
- `payload.network` and `payload.from` are auto-injected by wallet (PFC-1 §8.3 already expects this).
- `traceId` UUID v7 — opaque debug id, new metadata to record.
- Wallet UI rendering for binary payload — **not recorded** (observer did not report).

### Phase 4b — `signMessage`

Not run as a separate trial in the captured session. Pre-session probe of `@tonconnect/ui@2.1.0` and `@tonconnect/ui@2.4.4` bundles: zero occurrences of `signMessage` in either. PFC-1 §8.3 "signMessage" is **a renamed RPC**, never present in the JS UI SDK under that name. Code path would throw `TypeError: tc.signMessage is not a function`.

### Phase 5 — `signData` / `text`

Captured. payload textarea was left at default base64 (treated as an opaque UTF-8 string):

```json
{
  "signature": "8yeuVrxkkTp/XzNr2voynl6qJhIdEkPiPSwyO4q46q+QfJFbvceutfgGvhVv7OBRHc+w5KdXYRCi7gsbRlAdBg==",
  "address": "0:28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8",
  "timestamp": 1780128676,
  "domain": "10076c73b909ca.lhr.life",
  "payload": {
    "network": "-3",
    "from": "0:28f02e39a0ec4993febb273663f99ae2ebf8638069738fd37e5702179ce1c1b8",
    "type": "text",
    "text": "WyJhZ2VudGljX2NhbmNlbF9yb290X3dhbGxldF9zZXR1cCJd"
  },
  "traceId": "019e77f0-0b42-729b-a5bc-ac4fc2f66fef"
}
```

- Same byte content as Phase 4a, different `type` and `timestamp` → **different signature**. Confirms `type` and `timestamp` are inside the signed commit (cross-validates D1 below).
- Wallet UI rendering for text payload — **not recorded**.

### Phase 6 — `signData` / `cell`

SDK-side rejection before reaching wallet:

```
[TON_CONNECT_SDK_ERROR] n
SignDataPayload validation failed: 'schema' is required
```

- `type:"cell"` requires a TL-B `schema` field (mandatory, not optional).
- Out of scope for opaque-BOC observation. Testable only with a real cell layout.

### Phase 10 — reconnect

Implicitly covered by Phase 3 entries #2 (disconnect → connect, same origin) and #3/#4 (new origin → fresh connect). Pattern:

- Fresh modal-flow connect → wallet issues new ton_proof.
- Auto-restore from localStorage on hard-reload → `connectItems.tonProof` is `undefined` ("none" displayed). Not a divergence: TC SDK only requests proof during the modal-flow path where `setConnectRequestParameters` is set.

## Divergences captured (for matrix)

### MATRIX-D1 — signature is structured, not raw

PFC-1 (`docs/notes/ton-connect-ingress-design.md` §3, Execution Spec §8.3) assumes:
> *Wallet returns a raw Ed25519 signature over `payload.data` bytes.*

Observed: TC v2 `signData` returns a signature over a **structured commit** including domain prefix, domain length, timestamp, and `sha256(payload bytes)`. Response carries `timestamp` and `domain` top-level so the validator can reconstruct the same commitment.

**Affects:** `cal-validator-design.md` §8.1 (sig verification) and §10.2 (operator_pubkey byte-match). Validator cannot just call `ed25519_verify(payload_bytes, sig, pubkey)` — it must reconstruct the wallet-side hash schema.

**Resolution path (post-quiet-period):** update PFC-1 §8.3 to reference the TC v2 SignData hash schema. Validator §8.1 needs an alternative verify routine for the SignData channel.

**Byte-exact layout VERIFIED (2026-05-31, Gate #1).** This session's binary (Phase 4a) + text (Phase 5) captures were fed to `interop/tc-v2-commit-reconstruct.mjs`; `ed25519_verify` passes against both (and against MyTonWallet 4.10.1's pair), and rejects four negative controls. The signed commit is exactly: `sha256(0xFFFF ‖ "ton-connect/sign-data/" ‖ int32_be(workchain) ‖ addr_hash[32] ‖ uint32_be(domain_len) ‖ domain ‖ uint64_be(timestamp) ‖ "txt"/"bin" ‖ uint32_be(payload_len) ‖ payload)`. The Phase 4a/Phase 5 signature difference at identical content is fully explained: `type` enters via the 3-byte `"txt"`/`"bin"` prefix and `timestamp` via `uint64_be`. Full record: matrix §10.2.

### MATRIX-D2 — SDK method is `signData`, not `signMessage`

`@tonconnect/ui` (verified versions 2.1.0 and 2.4.4) does not export `signMessage`. PFC-1 §8.3 text says "signMessage" — historically correct RPC name in TC v1, but the v2 JS SDK has renamed it to `signData`.

**Resolution path:** wording fix in PFC-1 §8.3 — clarify that "signMessage" is the historical RPC method name; the modern TC v2 JS SDK exposes it as `signData`. No semantic change.

### MATRIX-D3 — per-type field naming, not generic `data`

TC v2 `SignDataPayload` uses per-type field names: `text` for text, `bytes` for binary, `cell` for cell. PFC-1 §8.3 / `ton-connect-ingress-design.md` text references `payload.data` generically.

**Resolution path:** wording fix in PFC-1 §8.3 — explicit per-type field names. dApp `index.html` already patched to construct the correct shape.

### MATRIX-D4 — cell type requires TL-B schema

`SignDataPayload` for `type:"cell"` requires `schema` field (TL-B description). Not optional.

**Implication:** confirms PFC-1's implicit ranking of `binary` over `cell` for the owner-sig channel is correct. If we ever want `cell`, we need a TL-B schema for the CAL serialization variant.

## Deferred phases

- **7** — Size probe (4 KiB binary). Started; tunnel died before capture.
- **8** — Reject path (wallet-side cancel).
- **9** — `sendTransaction` (testnet self-1nTON). Safe to run — testnet confirmed via `payload.network = "-3"`.
- **11** — Unicode payload (text type, emoji + CJK + RTL).
- **12** — Export JSON from dApp. **Partial export possible from the current browser session.**

## Open questions

- IDN domain → does `domain.lengthBytes` correctly use byte count when it differs from char count?
- Wallet UI rendering for binary vs text payloads.
- Approval-popup behavior on Reject.
- Cell signing with a valid TL-B schema.

## Lessons / scaffolding fixes

- `interop/dapp/index.html` line 117: bumped `@tonconnect/ui@2.1.0 → 2.4.4` (2.1 didn't expose signData).
- `interop/dapp/index.html` lines 263–270: payload object built with per-type field name (`text`/`bytes`/`cell`), not generic `data`.
- ssh reverse tunnels (localhost.run, pinggy free tier) are too flaky for a long session. **For next session: get pinggy Pro or use a more stable public host** (GitHub Pages from a sanitized export branch is a reasonable option per PFC-1 §6.3 governance — but only if the branch is restricted to observational scaffolding).
