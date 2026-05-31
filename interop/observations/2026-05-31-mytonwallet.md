# Session notes — 2026-05-31 — MyTonWallet testnet observation

**Status:** Phases 2, 3, 4a, 5, 8, 9, 10(partial), 12 captured. **D1 → A** [`c7493e4`]; transport node [`3e7e5ea`]. Phase 9: deploy = WalletV5R1 seqno 0; steady-state tx seqno 2 (opcode `0x7369676e`). Phase 8: two reject classes (`n` user-cancel / `e` not-sent). Phase 12: export works. Phase 11 (Unicode) DONE: multi-script verbatim echo (35B) + NFD probe → **wallet does NOT NFC-normalize** (`Cafe%CC%81` echoed verbatim) ⇒ text must be NFC-normalized upstream; reinforces PFC-1 binary-over-text. Empty-text SDK reject noted. Phase 6 (cell), 7 (size) deferred. Divergences: D5, D6.

**Primary objective (highest-ROI):** capture the **D1 classification column** for MyTonWallet
(matrix §10.1). One `signData`/`binary` trial yields all five comparison axes and decides
D1 → A / B / C. Everything else this session is opportunistic.

**Discipline (anchor `z3h0ix`):** interop OBSERVES, PFC-1 DEFINES. Record evidence only.
Do NOT draft any §8.3 spec PR this session, even if MyTonWallet confirms case A. Quiet period:
spec wins regardless. `interop-smoke` stays local until D1 is classified.

**Setup**

- Branch: `post-pfc1/interop-smoke`
- dApp: **live GitHub Pages** — `https://ooopalladiumsb.github.io/paradigm-terra/`
  (no local server, no tunnel — stable HTTPS endpoint; verified TC UI `2.4.4`, signData + per-type fields present, manifest `url`/`iconUrl` correct)
- TonConnect UI: `2.4.4` (exposes `signData`)
- Public reach: N/A — Pages is the stable origin. Domain is fixed ASCII (`ooopalladiumsb.github.io`, 24 bytes).
- **Note:** Pages domain cannot exercise the IDN `domain.lengthBytes` question (byte≠char). That stays open.
- **Note:** MyTonWallet is stricter than Tonkeeper about manifest icon 404s — `iconUrl` now points at a guaranteed-available GitHub avatar.

## Wallet under test

| Field | Value |
|---|---|
| Name | mytonwallet |
| Version | 4.10.1 |
| Form factor | browser |
| Account address | `0:fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268` |
| Pubkey (raw32 hex) | `330eba04a55777e3e14d4080092e5d31540b924b23d8d5a7c025be097cce5411` |
| Network | PENDING (expect `-3` testnet — confirm in Phase 4a `payload.network`) |
| Advertised features | `SendTransaction` (legacy string), `{name:"SendTransaction", maxMessages:255}`, `{name:"SignData", types:["text","binary","cell"]}` |
| `SignData` in features | **present** — `types: ["text","binary","cell"]` (identical to Tonkeeper) |
| `SignData` types advertised | `["text","binary","cell"]` |
| Wallet contract version | PENDING |

**Features delta vs Tonkeeper 4.7.0:** MyTonWallet's `SendTransaction` object is `{name, maxMessages:255}` — it does **NOT** advertise `extraCurrencySupported:true` (Tonkeeper did). `maxMessages:255` identical. `SignData` block byte-identical. Minor, not D1-related; logged as a feature-matrix datum.

---

## ★ D1 comparison axes — PRIMARY DELIVERABLE

Fill this from the Phase 4a (`binary`) + Phase 5 (`text`) captures. This column drops
straight into matrix §10.1.

| Axis | Tonkeeper 4.7.0 (reference) | MyTonWallet 4.10.1 (Phase 4a) |
|---|---|---|
| commit format | `sha256(prefix ‖ domain_len ‖ domain ‖ timestamp ‖ sha256(bytes))` | consistent — `timestamp`+`domain` echoed top-level (same structural tell). Byte-layout not independently verified; **type-in-commit cross-check pending Phase 5** |
| domain binding | yes — domain inside commit + echoed top-level | **yes** — `domain` "ooopalladiumsb.github.io" (24B) echoed top-level |
| timestamp inclusion | yes — inside commit + echoed top-level | **yes** — `timestamp` 1780210455 echoed top-level |
| payload hashing | `sha256(payload.bytes)` — NOT raw bytes | **NOT raw** ✓ — Phase 5 confirms signature varies with `type`/`timestamp` though content field identical; raw-byte signing ruled out |
| returned signature object | base64 64-byte Ed25519 + top-level `timestamp` / `domain` | **base64 64-byte Ed25519 + top-level `timestamp`/`domain`** ✓ identical — PLUS `address` in user-friendly base64url (see D5) |

**How to read the axes (no signing key needed):**
- `payload hashing` / `commit format`: send the **same byte content twice** with the
  *same* `type` and (if possible) note timestamps. Then send same bytes with a *different*
  `type` — if signature changes, `type` is inside the commit (Tonkeeper behavior). The
  signature being non-reproducible from `ed25519_verify(payload_bytes, sig, pubkey)` is the
  D1 signal; the top-level `timestamp`/`domain` echo is the tell that they're in the commit.
- `returned signature object`: record exact JSON shape — is `signature` base64 or hex? are
  `timestamp` and `domain` present as top-level fields?

**Classification (assign at end, per §10.1 enum):**
- **A `TC_V2_COMMIT_MODEL`** — MTW commit == Tonkeeper commit → D1 is real protocol pressure.
- **B `TONKEEPER_SPECIFIC`** — MTW signs raw `payload.bytes` → D1 downgrades to interop note.
- **C `WALLET_CLASS_VARIANCE`** — partial/different again → spec must enumerate commit schemas.

**Assigned classification:** **A — `TC_V2_COMMIT_MODEL`**

Two independent TC v2 implementations (Tonkeeper 4.7.0, MyTonWallet 4.10.1) both produce a
structured SignData commit binding domain + timestamp, return base64 64-byte Ed25519, and echo
`timestamp`/`domain` top-level. MyTonWallet does NOT sign raw `payload.bytes` (Phase 5). →
D1 is a property of the **TON Connect v2 signing model**, not Tonkeeper-specific.

**Consequence (per §10.1):** D1 is a serious **post-freeze clarification candidate** for
Exec-spec §8.3 — the validator must adopt the TC v2 SignData hash schema as the canonical
owner-sig verify routine (cannot `ed25519_verify(payload_bytes, sig, pubkey)` directly).
Strengthens Freeze gates #1 (real Ed25519) + #4 (e2e smoke). **Spec PR still deferred — quiet
period; this slot records evidence only.** Remaining hardening: byte-exact commit-layout
reconstruction + ed25519 verify (un-done in both sessions).

---

## Phase coverage

### Phase 2 — Connect
Captured. See wallet table above. MyTonWallet 4.10.1 browser, `SignData` advertised with
`types:["text","binary","cell"]`. Only feature delta vs Tonkeeper: no `extraCurrencySupported`.

### Phase 3 — ton_proof
Captured (from connect log, session 07:09:24Z). `max_protocol_version: 2`.

| # | Domain | `lengthBytes` | timestamp (UTC) | Notes |
|---|---|---|---|---|
| 1 | ooopalladiumsb.github.io | **24** | 2026-05-31T (ts 1780211353) | initial connect |

```json
"proof": {
  "timestamp": 1780211353,
  "domain": { "lengthBytes": 24, "value": "ooopalladiumsb.github.io" },
  "payload": "botvmjojzz/bIb2NCGASOzY6xxr/uQFOG9459WVUJmc=",
  "signature": "RrL/RA76ks6UYMKv0ZpxDiiiLj11FnGq16ecX4loCrKjJSnd1pUQMLacJ2PYYXyT3IMOJ911AtDmmA4rketTBw=="
}
```

- `signature`: base64 → **64 bytes** Ed25519. ✓
- `domain.lengthBytes` = 24 = byte count of `ooopalladiumsb.github.io` (ASCII). Matches Tonkeeper's
  ASCII-domain behavior. IDN byte≠char case still untestable from Pages.
- `payload`: 32 bytes (the dApp-generated nonce, echoed verbatim base64). ✓
- Single connect captured; freshness-across-reconnect not re-probed (already established on Tonkeeper).

### Phase 4a — `signData` / `binary`  ← drives D1
Captured. Full response:

```json
{
  "signature": "F31Se0AAztZR3JkbWYwxUvbNKTsDdf3ZbyhGo3IzL2t9kxkpV/Q1WzTJO+ciiSHrT9SL9hjI8Ym9fdKQldQmDw==",
  "address": "0QD6xP-v3wm4O6uV-PxXl6vVFFvEMg4C7kHiLFrV-3PyaF4Q",
  "timestamp": 1780210455,
  "domain": "ooopalladiumsb.github.io",
  "payload": {
    "type": "binary",
    "bytes": "aW50ZXJvcC1vYnNlcnZhdGlvbi1zYW1wbGU=",
    "from": "0:fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268",
    "network": "-3"
  },
  "traceId": "019e7ccf-bb7e-7793-9674-a03f672007c6"
}
```

Decoded / verified facts:
- `signature`: base64 → **64 bytes** Ed25519 (not hex). Same encoding as Tonkeeper. ✓
- top-level `timestamp` (1780210455) + `domain` ("ooopalladiumsb.github.io", **24 bytes** ASCII) present → same structural tell as Tonkeeper that both are inside the signed commit.
- `payload.network` = **"-3"** → **testnet confirmed** (Phase 9 self-send now safe).
- `payload.from` auto-injected (raw `0:...`), hashpart == connect address. ✓
- `payload.bytes` decodes to `interop-observation-sample`.
- `traceId` UUID v7 — same opaque-debug-id metadata as Tonkeeper.

**NEW divergence vs Tonkeeper — top-level `address` encoding (→ D5):**
MyTonWallet returns the top-level `address` in **user-friendly base64url** form
(`0QD6xP-v3wm4…`, tag `0xd1` = testnet non-bounceable, wc 0), whereas Tonkeeper returned
raw `0:hex`. Decoded hashpart == `payload.from` hashpart == same account, so it is purely a
representation difference in the response object — but a validator parsing `address` must
accept BOTH forms. Logged below as D5 (observable, not consensus-affecting if validator keys
off `payload.from`, which is raw in both wallets).

### Phase 4b — `signMessage`
Pre-known (D2): `@tonconnect/ui` 2.4.4 has no `signMessage` export; `tc.signMessage(...)`
throws `TypeError`. Confirm the same on this dApp build, or note if MTW exposes anything different.

### Phase 5 — `signData` / `text`  ← cross-checks D1
Captured. Full response:

```json
{
  "signature": "DZ8d/yfc0DolG3TLacRs/zEb8vbc7PM5KGE36X93YSxfTA2y5fe0Z5A2yjaBJFntwlXiJbtsdvJm94OBk+GxBA==",
  "address": "0QD6xP-v3wm4O6uV-PxXl6vVFFvEMg4C7kHiLFrV-3PyaF4Q",
  "timestamp": 1780210616,
  "domain": "ooopalladiumsb.github.io",
  "payload": {
    "type": "text",
    "text": "aW50ZXJvcC1vYnNlcnZhdGlvbi1zYW1wbGU=",
    "from": "0:fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268",
    "network": "-3"
  },
  "traceId": "019e7cd2-3b7b-723d-86ed-1a2482f215b4"
}
```

Cross-check vs Phase 4a:
- content field value **identical** (`aW50ZXJvcC1vYnNlcnZhdGlvbi1zYW1wbGU=`), `type` differs
  (`binary`→`text`), `timestamp` differs (1780210455→1780210616) → **signature differs**.
- ⇒ signature is **not** a function of payload bytes alone. Raw-byte signing is ruled out;
  the structured-commit model (domain + timestamp + type bound in) is confirmed — same as Tonkeeper.
- `text` field is signed as an opaque UTF-8 string (the literal 36-char base64 text), not decoded.

**Honest caveat (recorded, not interpreted away):** because `binary` decodes the base64 (26
bytes) while `text` signs the literal 36-char string, the two trials do not isolate a
single variable. The cleanest possible proof (same type + same content, timestamp-only delta)
was not isolated this session. However, classification does not depend on it: raw-byte signing
cannot explain the top-level `domain`+`timestamp` echo present in BOTH responses, so the
structured commit is unambiguous. Byte-exact commit layout remains un-verified in both wallet
sessions — that is a Freeze-gate-#1 hardening step, not a classification blocker.

### Phase 6 — `signData` / `cell`
Pre-known (D4): SDK rejects without TL-B `schema` (`'schema' is required`). Confirm MTW path
errors the same way, or record divergence.

### Phase 7 — size probe (4 KiB binary)
PENDING (deferred on Tonkeeper — tunnel died). Stable Pages host makes this runnable now.
Record: accepted? truncated? wallet warning?

### Phase 8 — reject path
Captured (session 12:38, export). **Two distinct SDK error classes** observed across repeated
`sendTransaction` attempts:

| Error class | message | likely cause |
|---|---|---|
| `n` | `[TON_CONNECT_SDK_ERROR] n: User rejects the action in the wallet.\nCanceled by the user` | explicit user cancel at approval popup |
| `e` | `[TON_CONNECT_SDK_ERROR] e\nTransaction was not sent` | NOT an explicit reject — popup dismissed/closed or bridge failed to deliver; no "rejects" wording |

- `code: null` on both — no numeric error code surfaced; classification only via message text + minified class letter.
- A relayer/validator distinguishing "user said no" from "delivery failed" must parse the message string (`n:`/`User rejects` vs `e`/`Transaction was not sent`), since `code` is null.

### Phase 9 — `sendTransaction` (testnet self-send, 1 nanoTON)
**ATTEMPT 1 — blocked at SDK client-side validation (did NOT reach wallet). → D6.**

Two attempts (07:09:37Z, 11:59:07Z), both identical:

```
send_request  tx.messages[0].address = "0:fac4ffafdf09b83bab95f8fc5797abd5145bc4320e02ee41e22c5ad5fb73f268"  (raw 0:hex)
send_error    [TON_CONNECT_SDK_ERROR] SendTransactionRequest validation failed:
              Wrong 'address' format in message at index 0    (latency 4–12 ms → pre-wallet)
```

Root cause (read from `@tonconnect/sdk@3.4.1` source, the dep of `@tonconnect/ui@2.4.4`):
```js
if (!isValidString(message.address)) { return `'address' is required in message at index ${i}`; }
if (!isValidUserFriendlyAddress(message.address)) { return `Wrong 'address' format in message at index ${i}`; }
```
`sendTransaction` requires a **user-friendly base64url** address. TON Connect `connect` provides
`account.address` in **raw `0:hex`**. The harness passed raw verbatim → client-side reject.

- The raw address is itself valid (workchain 0, 32-byte hex) — rejection is purely the format
  the validator accepts, not a bad address.
- **This is NOT MyTonWallet behavior** — it's a TonConnect SDK contract asymmetry + a harness
  defect. Reproduces on any wallet. Logged as D6 (transport/tooling), not a wallet-divergence.
- The wallet was never invoked → Phase 9's real targets (BOC / contract version / approval UX /
  dust threshold) remain **uncaptured**. Needs ATTEMPT 2 with the fixed harness.

**Harness fix applied** (`interop/dapp/index.html` source + gh-pages `d5cf2e1`, **live on Pages**):
normalize raw→friendly via the SDK's own `toUserFriendlyAddress(rawAddr, testOnly)`
(`testOnly = account.chain === CHAIN.TESTNET`); `send_request` now logs raw + friendly + testOnly.
Produces non-bounceable testnet form (`0Q…`) — matches the D5 form MyTonWallet itself returns.

**ATTEMPT 2 — SUCCESS (happy-path).** Fixed harness (friendly addr) passed SDK validation,
wallet approved, returned a BOC. Response:

```json
{ "boc": "te6cckECGQEAA2MAA+eIAfWJ/1++E3B3Vyvx+K8vV6oot4hkHAXcg8RYtav25+TQEY5tLO3P…" }
```

Decoded (local BOC parser, `/tmp/bochash.py`): external-in message, **25 cells → carries StateInit
⇒ this tx DEPLOYS the wallet**. Findings:
- **Contract = WalletV5R1.** Code-cell hash = `20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f` (canonical W5R1).
- Data cell (322 bits, W5 layout): `is_signature_allowed=1`, **`seqno=0`** (fresh → first deploy),
  `wallet_id=0x7ffffffd`, `pubkey=330eba04…cce5411` (**matches connected account** ✓), trailing
  empty-extensions-dict bit `0`.
- Internal transfer (cell #24): dest hash `fac4ffaf…f268` = **self** ✓; **bounce bit = 0**
  (non-bounceable — consistent with the friendly `0Q…` form); value = 1 nanoTON.

**Significance (Gate #4):** first real end-to-end transport happy-path — dApp → SDK → wallet →
signed external message. MyTonWallet 4.10.1 (testnet) provisions **W5R1 directly**, not the W4
the matrix candidate row assumed. seqno=0 confirms the account was undeployed before this tx.

**Soft observations still open:** approval-popup rendering, on-chain confirmation, dust-threshold
behavior at 1 nanoTON (wallet accepted 1 nTON into the BOC → no client-side dust floor pre-broadcast).
Round-trip latency observed (session 12:38, export): signData ≈ 11.9 s; successful sendTransaction
≈ 29 s (incl. user re-attempts). Wallet round-trips are seconds-scale, human-paced.

**Steady-state tx — ATTEMPT 3 (session 12:38, second BOC, non-deploy).** A later success in the
export produced a 4-cell BOC with **no StateInit** (wallet already deployed). Decoded W5 external
body: opcode **`0x7369676e`** ("sign" — W5R1 external auth prefix, cross-confirms the code-hash ID),
`wallet_id=0x7ffffffd`, `valid_until=1780231587` (matches the 12:41:27 `send_request`), **`seqno=2`**
(steady state — account had advanced past deploy). Internal transfer cell byte-identical to the
deploy tx's (self, non-bounceable, 1 nTON). This is the **relayer-relevant steady-state message
shape** (vs the deploy-bundled first tx). A further steady-state tx (session 12:51, after the
Phase 11 signData) decoded to **seqno 3** (same opcode `0x7369676e`, valid_until 1780232187) —
confirms monotonic seqno increment (0 deploy → 2 → 3) and stable 4-cell non-deploy shape.

### Phase 10 — reconnect
Partially captured. Session 12:38 was a **fresh modal-flow connect** producing a **new ton_proof**:
nonce `6q4lcoa19Yay8itXETx/ko+F9AOjg/uDdxL4uhzwuzU=`, timestamp 1780231131, new 64-byte signature —
distinct from the 07:09 connect (nonce/ts/sig all fresh). Confirms **fresh proof per modal connect**
(matches Tonkeeper). Hard-reload auto-restore (localStorage, proof absent) path not separately probed.

### Phase 11 — Unicode payload (text)
**DONE (partial).** Session 12:50, `signData/text`, input `Hello é 你好 🌍 ابحرم ﷽` (latency 14074 ms).

Codepoints: `H e l l o · U+00E9(é) · 你 好 · U+1F30D(🌍) · ا ب ح ر م · U+FDFD(﷽ BISMILLAH ligature)`.

- **Verbatim echo, byte-identical.** `sign_request.data` == `sign_response.payload.text`, both **35
  bytes UTF-8** (`48656c6c6f20c3a920e4bda0e5a5bd20f09f8c8d20d8a7d8a8d8add8b1d98520efb7bd`). Wallet does
  NOT alter emoji / CJK / Arabic-RTL / the U+FDFD ligature in the echo — full multi-script byte fidelity.
- First-trial input was **already NFC** (precomposed acute) -> couldn't test normalization there.

**NFC-normalization probe -- RESOLVED (sessions 13:28 & 13:33).** Input forced to **NFD** via
console (`payload-data = 'Cafe' + U+0301` combining acute, guaranteed decomposed). Signed via
`signData/text`. Read the wallet's echoed `payload.text` codepoints (`encodeURIComponent` of the
response -- transport-safe):

```
encodeURIComponent(resp.payload.text)  ->  "Cafe%CC%81"
```

`%CC%81` = UTF-8 of U+0301. Wallet echoed the **decomposed (NFD) bytes verbatim**.

=> **MyTonWallet 4.10.1 does NOT NFC-normalize the `text` payload -- it signs/echoes the exact
UTF-8 bytes received.** (Two NFD trials; distinct sigs via timestamp.)

**Consequence for CAL / PFC-1 §8.3:** the wallet commits to *received* bytes, while our validator
pins NFC (Unicode-15.1). So any `text` owner-sig channel must be **NFC-normalized UPSTREAM**
(relayer/dApp) before bytes reach the wallet -- the wallet won't do it. This **reinforces PFC-1's
existing choice of `binary` (pre-canonicalized bytes) over `text`** for the owner-sig channel:
binary sidesteps wallet-side normalization ambiguity entirely (parallels D4's binary-over-cell
ranking). No spec change -- confirms existing design. Evidence only.

**signData input validation (bonus, session 12:50):** empty `text` → SDK-side reject
`[TON_CONNECT_SDK_ERROR] n  SignDataPayload validation failed: 'text' is required` (latency 1–5 ms,
pre-wallet, `code: null`). Five rapid attempts, all rejected client-side. Confirms `text` is a
required non-empty field at the SDK layer (sibling of D4's `'schema' is required` for `cell`).

### Phase 12 — export JSON
**DONE.** Full session export works: `session_id`, `started_at`/`exported_at`, `tc_lib`, wallet
block, derived `features` map, and complete `events[]` log (init→ready→connect→proof→sign→send×N).
The `send_request` events now carry `raw_address`/`friendly_address`/`test_only` (D6 fix telemetry).
Note: `sign_request` logs the payload generically as `{type, data}` (harness log shape), while the
SDK/response correctly use the per-type key `text` (D3) — logging artifact, not a payload defect.

---

## Divergences captured (delta vs Tonkeeper / spec)

(Record only NEW divergences or confirmations/refutations of D1–D4. Do not re-derive
D2/D3/D4 unless MTW behaves differently.)

- **D1 — CONFIRMED → A `TC_V2_COMMIT_MODEL`:** MTW reproduces the structured commit (Phase 5
  rules out raw-byte signing; same structural tells as Tonkeeper). 2nd independent wallet →
  classification assigned. See ★ D1 block above.
- **D2 — same as Tonkeeper** (signData not signMessage). No re-derivation needed unless probed.
- **D3 — confirmed:** per-type field `bytes` used for binary (matches Tonkeeper / dApp shape).
- **D5 — NEW (observable, non-consensus):** top-level `address` returned in user-friendly
  base64url (`0Q…`, testnet non-bounceable) by MyTonWallet vs raw `0:hex` by Tonkeeper.
  `payload.from` is raw `0:hex` in both. Resolution path: validator must accept both `address`
  representations OR key identity strictly off `payload.from`. Spec PR deferred (quiet period).
- **D6 — NEW (SDK/transport, tooling-level, non-consensus):** TonConnect SDK contract is
  internally **asymmetric about address form** — `connect` returns `account.address` as raw
  `0:hex`, but `sendTransaction`'s validator requires **user-friendly base64url**
  (`isValidUserFriendlyAddress`, `@tonconnect/sdk@3.4.1`). A dApp/relayer feeding the connect
  address straight into a message is rejected client-side. **Not wallet-specific** (SDK-level;
  reproduces on any wallet). **Low PFC-1 impact** — §8.3 concerns the owner-sig (signData)
  channel, not the W5 external-message (sendTransaction) channel — but the eventual relayer that
  submits external messages MUST normalize raw→friendly (`toUserFriendlyAddress`). Cross-links
  D5: the friendly form D5 flags as MyTonWallet's quirk is in fact the form `sendTransaction`
  demands. Resolution: tooling/relayer normalization note; no spec change.

## Open questions (carry-over)

- IDN domain `domain.lengthBytes` byte-vs-char — still untestable from Pages (ASCII domain).
- Wallet UI rendering for binary vs text payloads.
- (add MTW-specific questions as they surface)

## Lessons / scaffolding fixes

- PENDING
