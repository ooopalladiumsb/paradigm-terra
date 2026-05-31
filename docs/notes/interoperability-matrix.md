# Interoperability matrix — TON Connect / W5 / paradigm_terra

**Status:** Scaffold (post-PFC-1, exploratory). Not normative. Tracks empirical
results from real-wallet integration smoke testing of the PFC-1 transport
contract (`docs/spec/execution-spec-v1.md` §8.3 + `docs/notes/ton-connect-ingress-design.md`).

**Observation sessions logged:**
- `2026-05-30` — Tonkeeper 4.7.0 (Chrome extension, testnet `-3`). Partial:
  phases 2/3/4a/5/10 captured, 6 closed by SDK, 7/8/9/11/12 deferred. Four
  divergences recorded (D1–D4, see §10). Notes: `interop/observations/2026-05-30-tonkeeper.md`.

**Purpose.** Convert PFC-1's *specification-level* transport assumptions into
*observed* behavior across real TON Connect v2 wallets, before any semantic
expansion. The matrix is the artifact; everything else (test scripts, dApp
shims, Tonkeeper sessions) is scaffolding around it.

**Scope guardrails (quiet period, see README PFC-1 → Freeze gates).**

| Permitted | Forbidden |
|---|---|
| Recording observed wallet behavior | New protocol fields |
| Flagging spec ambiguity for clarification | New consensus semantics |
| Identifying spec-vs-real divergence | New hash inputs |
| Adding test wallets / environments | New canonicalization rules |
| Tightening edge-case wording in spec | New crypto semantics |

If observed behavior contradicts spec, the **spec wins** during quiet period;
the divergence becomes a "wallet quirk" row, not a spec amendment. Spec changes
wait for post-quiet-period.

---

## 1. Wallet candidates

Each row is a TON Connect v2-compliant wallet whose on-chain contract is either
W5 (`v5r1`) directly or an Agentic Wallet SBT built on W5. Tested-against status
is empirical, not aspirational.

| Wallet | Form factor | Contract version | TC v2 | Testnet | Status |
|---|---|---|---|---|---|
| Tonkeeper | mobile + browser ext | W5 (`v5r1`) | ✓ | ✓ | **2026-05-30: 4.7.0 browser ext, testnet — partial (5/12 phases, D1–D4 captured)** |
| MyTonWallet | browser ext + mobile | **W5R1 observed** (deploy seqno 0→2→3, testnet) | ✓ | ✓ | **2026-05-31: 4.10.1 browser, testnet — Phases 2/3/4a/5/8/9/10p/11p/12; D1→A; D5/D6; deploys WalletV5R1; reject classes n/e; Unicode verbatim, no wallet NFC-normalization; signData/binary ≤16 KiB OK** |
| Tonhub | mobile | W4 default | ✓ | ✓ | not yet tested |
| OpenMask | browser ext | W4 default | ✓ | ✓ | not yet tested |
| Wallet (Telegram) | in-app | proprietary on-chain | ✓ | ? | not yet tested |
| Agentic Wallet SBT | dashboard-deployed | W5-based SBT | ✓ | ✓ | not yet tested |

Selection rule for first pass: **Tonkeeper testnet** as the reference (largest
W5 install base, official). Second pass adds MyTonWallet and Tonhub. Agentic
Wallet SBT goes last because deploying one needs the agents.ton.org flow.

---

## 2. signMessage behavior

**Spec contract (PFC-1).** `payload.type = "binary"`, `payload.data =
base64(canonical_bytes(cal_without_signatures))`. `payload.network` and
`payload.from` are present but NOT hashed into `CAL_HASH`. Wallet returns a raw
Ed25519 signature over `payload.data` bytes.

**Open questions to measure:**

| Question | Expected | Observed (per wallet) |
|---|---|---|
| Does the wallet sign the raw `data` bytes verbatim, or prepend a wallet-domain prefix internally? | Raw per TC v2 §6 for `binary` | **NO — see D1 / §10.2 (byte-exact, ed25519-VERIFIED).** Signs `sha256(0xFFFF ‖ "ton-connect/sign-data/" ‖ workchain ‖ addr_hash ‖ domain_len ‖ domain ‖ timestamp ‖ "txt"/"bin" ‖ payload_len ‖ payload)`; `timestamp` + `domain` echoed top-level so validator can rebuild. Confirmed Tonkeeper 4.7.0 + MyTonWallet 4.10.1. |
| Does the wallet render a human-readable preview of the CAL JSON when `type=binary`? | "Unknown binary" or hex | TBD (Tonkeeper 4.7.0: approval-UI rendering not recorded in 2026-05-30 session) |
| Max accepted `payload.data` size? | ≥ 4 KiB (informal) | TBD (Tonkeeper 4.7.0: Phase 7 size probe interrupted by tunnel drop) |
| Does refusing → cancel surface as an RPC error or silent timeout? | Error per TC §3.2 | TBD (Tonkeeper 4.7.0: Phase 8 reject path not run) |
| Returned signature encoding — hex vs base64? | base64 per TC §6 | **Tonkeeper 4.7.0: ✓ base64** (88-char padded = 64-byte Ed25519 raw) |

**Test harness.** A minimal Node script (`interop/sign-message.mjs`, not yet
written) that opens a TC session, sends a canonical CAL with known
`operator_pubkey`-signed twin, asks owner for `signMessage`, verifies the
returned signature against `payload.data` with `tweetnacl.sign.detached.verify`.

---

## 3. ton_proof behavior

**Spec contract (PFC-1).** Returned proof's `domain.value` MUST match
orchestrator's origin. Signature verifies per TC v2 §6: prefix
`ton-proof-item-v2/` || workchain || address || domain length || domain ||
timestamp || payload, signed with wallet's pubkey.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| `domain.lengthBytes` correctness on multi-byte domains (e.g. IDN)? | Bytes, not chars | TBD (Tonkeeper 4.7.0: ASCII-only tested across 4 captures on 3 domains; `lengthBytes` always equals char count. IDN case still open.) |
| `timestamp` clock skew tolerance accepted by wallets? | ±300 s informal | TBD |
| Does the wallet refresh `ton_proof` automatically on reconnect, or require a new request? | Per TC: new request | **Tonkeeper 4.7.0: ✓ fresh proof on every modal-flow Connect** (verified across 4 captures). Auto-restore from `localStorage` on page reload does NOT issue new proof — `connectItems.tonProof` is `undefined`. Behavior matches TC SDK design (proof only when `setConnectRequestParameters` is set before `openModal`). |
| What does the wallet return for `payload` echo — verbatim base64, or decoded? | Verbatim | **Tonkeeper 4.7.0: ✓ verbatim** base64 of the dApp-supplied 32-byte random nonce. **MyTonWallet 4.10.1: ✓ verbatim, AND the literal base64 string (not the decoded 32 bytes) is what enters the signed commit** — confirmed by ed25519 verify, §3.1. |
| Does `ton_proof` returned `address` use raw `0:<hex>` or user-friendly form? | User-friendly per TC | Tonkeeper 4.7.0: proof object itself does **not** echo `address` (only `timestamp`/`domain`/`payload`/`signature`). Account address surfaces separately via `wallet.account.address` as raw `0:<hex>` (workchain `0`). User-friendly form not observed in this transport. |

**Validator-side invariant** (PFC-1 §10.2 of `cal-validator-design.md`): the
pubkey extracted from `ton_proof` MUST byte-match
`state.registry.agents[id].operator_pubkey` raw 32 bytes. User-friendly forms
in the TC envelope are stripped before comparison.

### 3.1 ton-proof-item-v2 byte layout — VERIFIED

Companion to §10.2. The MyTonWallet 4.10.1 Phase 3 `ton_proof` capture (signature +
pubkey + domain + timestamp + nonce) was fed to `interop/ton-proof-verify.mjs`;
`ed25519_verify` holds against the reconstructed commit and rejects four negative
controls (corrupted sig, ts off-by-one, domain mismatch, tampered nonce). A single
capture suffices: ed25519 verification passes only if the reconstructed bytes are
byte-identical to what the wallet signed, so the layout is cryptographically pinned
among candidates.

```
inner   = utf8("ton-proof-item-v2/")
        ‖ int32_be(workchain) ‖ address_hash[32]
        ‖ uint32_le(domain_len) ‖ utf8(domain)
        ‖ uint64_le(timestamp)
        ‖ payload                       # the dApp nonce, signed as its literal
                                        # (base64) string bytes — NOT base64-decoded
verify  = ed25519_verify( sha256( 0xFFFF ‖ "ton-connect" ‖ sha256(inner) ),
                          signature, operator_pubkey )
```

**Key finding — the two TC v2 channels do NOT share byte conventions:**

| | signData (§10.2) | ton_proof (§3.1) |
|---|---|---|
| schema prefix | `ton-connect/sign-data/` | `ton-proof-item-v2/` |
| `domain_len` | **uint32 BE** | **uint32 LE** |
| `timestamp` | **uint64 BE** | **uint64 LE** |
| type prefix | `"txt"`/`"bin"` | none |
| outer hashing | `sha256(message)` | `sha256(0xFFFF ‖ "ton-connect" ‖ sha256(inner))` |

A validator implementing both owner-sig verification routines **must not** share
endianness/hashing logic across them — they are genuinely different commit schemes.
This is exactly the kind of byte-level detail the eventual §8.3/§10.2 normative
package must state per-channel (see `docs/notes/tc-v2-signdata-verify-v1.md`).

**Caveat:** both this capture and all §10.2 captures are workchain `0`, so workchain
endianness is unconstrained here (int32 BE/LE both `0x00000000`). domain_len and
timestamp endianness ARE pinned empirically by this capture (both non-zero). Repro:
`node interop/ton-proof-verify.mjs`.

---

## 4. valid_until handling

**Spec contract (PFC-1, Execution Spec §8.3 replay model).**
`TC.valid_until = unix_ts_at_tick(cal.expiration_tick)`. `TICK_DURATION = 5 s`
(Execution Spec §5). Wallets reject signing if `valid_until` is in the past.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| What's the minimum delta `valid_until - now` wallets accept? | Several seconds | TBD |
| Maximum future window before warning / refusal? | Unspecified | TBD |
| Behavior at exact equality `valid_until == now`? | Spec silent | TBD |
| Wallet clock skew handling? | Not specified | TBD |
| When wallet refuses for `valid_until` expiry, error code? | TC error class | TBD |

**Spec ambiguity flagged for post-quiet clarification:** Execution Spec §8.3
doesn't pin the conversion factor between `expiration_tick` and `unix_ts`. With
`TICK_DURATION = 5 s` and genesis tick at unix-ts `T0`,
`unix_ts_at_tick(n) = T0 + 5 × n`. `T0` is not currently pinned in
constitution-v0.9.5.md §XII. → Candidate for a precision PR during quiet
period, since it's pure clarification (not a new field).

---

## 5. seqno edge-cases

**Spec contract (PFC-1).** CAL `nonce` is independent of TC `id` (Execution
Spec §8.3 — "TC id ≠ CAL nonce, namely разные ordering domains"). W5
`ContractState.seqno` increments per published external; CAL `nonce`
increments per-agent per-CAL globally.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| Does TC `id` reset across reconnects within the same session? | Per-session monotonic | TBD |
| What happens if orchestrator sends two `signMessage` requests with the same TC `id`? | Wallet rejects 2nd | TBD |
| If the wallet is asked to sign a CAL whose `nonce` is `state.cal.nonces[agent_id]` exactly (replay), how is it surfaced? | Spec silent — orchestrator's job | TBD |
| W5 `msg_seqno` mismatch (exit code 133) — how does the wallet surface it before TON broadcast? | TC client lib path | TBD |

---

## 6. payload size limits

**Spec contract (PFC-1).** No explicit upper bound on CAL canonical-bytes
length. Practical cap from W5: 255-message limit per external, but a CAL with
many `steps[]` could exceed reasonable wallet display.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| Max `payload.data` size Tonkeeper accepts? | TBD | TBD |
| Max `payload.data` size Tonhub accepts? | TBD | TBD |
| Behavior at exactly 4 KiB / 8 KiB / 16 KiB? | Three boundary tests | **MyTonWallet 4.10.1: all three signData/binary ACCEPTED, no error/truncation; latency human-paced (9–21 s), not size-bound. No ceiling ≤16 KiB.** 2026-05-31 |
| Does the wallet truncate signing input silently? | Hopefully not | **No** — full payload echoed back verbatim at 16 KiB (MyTonWallet 4.10.1) |
| Does W5 external body have its own size cap before TC throws? | TC bridge limit ~64 KiB informal | signData/binary ≤16 KiB passes SDK+bridge+wallet (MyTonWallet); breaking point not reached |

**Spec ambiguity flagged:** CAL Spec doesn't pin a max `payload.data` size.
Likely candidate for a §2.x ceiling at Conformance Freeze, not during quiet
period.

---

## 7. UTF-8 / binary handling

**Spec contract (PFC-1).** `payload.type = "binary"` with base64-encoded
canonical bytes. The wallet MUST NOT NFC-normalize, MUST NOT add BOM, MUST NOT
strip null bytes. The validator hashes pre-base64 raw bytes.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| Does the wallet alter binary `data` (BOM strip, encoding cast) before signing? | No alteration | TBD |
| Embedded NUL byte (`0x00`) in `payload.data` — wallet handling? | Pass through | TBD |
| `payload.type = "text"` — should we ever use it? | No (binary only) | confirmed by spec |
| Wallet base64 strictness (with/without padding, URL-safe vs standard)? | Standard with padding | TBD |
| Round-trip: sign → broadcast → on-chain payload bytes — do they match the signed bytes? | Yes per W5 spec | TBD |
| `text`-type multi-script echo fidelity (emoji/CJK/RTL/ligature)? | verbatim | **MyTonWallet 4.10.1: verbatim, byte-identical** (35B UTF-8 round-trip, `Hello é 你好 🌍 ابحرم ﷽`, U+FDFD intact) — 2026-05-31 |
| Does the wallet **NFC-normalize** a *decomposed* `text` input before signing? | (CAL pins NFC) | **NO** — MyTonWallet 4.10.1 echoes/signs NFD verbatim (NFD input `Cafe`+U+0301 → echoed `Cafe%CC%81`). Text must be NFC-normalized **upstream**; reinforces PFC-1's `binary`-over-`text` choice. 2026-05-31 |
| Empty `text` field handling? | reject | SDK rejects pre-wallet: `'text' is required` (MyTonWallet/SDK 3.4.1) |

---

## 8. mobile vs desktop behavior

**Spec contract (PFC-1).** Wallet UX is non-normative; protocol invariants
must hold across form factors.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| Does the mobile wallet show full CAL JSON preview for owner review? | Out of scope | informational |
| Browser ext: does focusing/blurring the dApp window cancel the in-flight signMessage request? | Out of scope; should be no-op for protocol | TBD |
| Mobile deep-link vs QR code — does either form factor change `ton_proof` semantics? | No | TBD |
| iOS Universal Link vs Android intent — equivalent? | Yes per TC v2 | TBD |
| Wallet daemon background-killed mid-session — error or silent failure? | Error per TC §3.2 | TBD |

---

## 9. disconnect / reconnect semantics

**Spec contract (PFC-1).** Bridge transport (NaCl `crypto_box`) is
out-of-consensus (`docs/notes/ton-connect-ingress-design.md` §5). Session keys,
nonces, TTLs are wallet-provider implementation. Re-connect requires fresh
`ton_proof` per `cal-validator-design.md` §10.

**Open questions:**

| Question | Expected | Observed |
|---|---|---|
| On unexpected bridge disconnect mid-`signMessage`, does the wallet remember the request? | Per TC §3.2: no | TBD |
| Re-connect within session TTL — same session key, or new keypair? | Implementation-defined | TBD |
| `ton_proof` re-issuance on every reconnect, or only on session TTL expiry? | Spec silent | **Tonkeeper 4.7.0: per fresh modal-flow Connect.** Auto-restore from `localStorage` returns to a connected state without issuing a new proof. Matches §3 row above. |
| Does the wallet expire `ton_proof` independently of TC session TTL? | Possibly | TBD |
| If orchestrator drops bridge mid-session, can it resume with same `client_id`? | Per TC: yes | TBD |

---

## 10. Cross-cutting: spec divergences observed (running log)

| # | Section | Observed deviation | Spec clarification candidate | Status |
|---|---|---|---|---|
| D1 | Exec-spec §8.3; `ton-connect-ingress-design.md` §3; `cal-validator-design.md` §8.1 + §10.2 | Wallet does NOT sign raw `payload.bytes`. `signData` signs a **structured commit** — **byte-exact layout VERIFIED** in §10.2: `sha256(0xFFFF ‖ "ton-connect/sign-data/" ‖ workchain ‖ addr_hash ‖ domain_len ‖ domain ‖ timestamp ‖ "txt"/"bin" ‖ payload_len ‖ payload)`; `timestamp` + `domain` echoed top-level so validator can rebuild. | Update §8.3 to reference the TC v2 SignData hash schema; validator §8.1 needs an alternative verify routine for the SignData channel (cannot call `ed25519_verify(payload_bytes, sig, pubkey)` directly). | **Open — Consensus-affecting. Classified `A — TC_V2_COMMIT_MODEL` 2026-05-31; byte-exact layout ed25519-VERIFIED 2026-05-31** (4/4 captures, 2 wallets — see §10.2, repro `interop/tc-v2-commit-reconstruct.mjs`). Spec wins during quiet period; PR deferred to post-quiet. Gate #1 (real Ed25519) evidence now in hand; Gate #4 (e2e smoke) still open. |
| D2 | Exec-spec §8.3 | `@tonconnect/ui` (2.1.0, 2.4.4) does not export `signMessage`; the TC v2 JS SDK renamed the RPC to `signData`. Calling `tc.signMessage(...)` throws `TypeError`. | Wording fix: clarify "signMessage" is the historical (TC v1) RPC name; modern TC v2 JS SDK exposes it as `signData`. No semantic change. | **Open — Cosmetic.** Spec PR (wording) deferred to post-quiet. |
| D3 | Exec-spec §8.3; `ton-connect-ingress-design.md` | TC v2 `SignDataPayload` uses per-type field names: `text` / `bytes` / `cell`. Spec references generic `payload.data`. | Wording fix: explicit per-type field names in §8.3. | **Open — Observable.** dApp `index.html` already patched to emit the correct shape; spec wording PR deferred to post-quiet. |
| D4 | Exec-spec §8.3 | `SignDataPayload` for `type:"cell"` requires a TL-B `schema` field (mandatory, SDK-side rejection: `'schema' is required`). | None — confirms PFC-1's implicit ranking of `binary` over `cell` for the owner-sig channel. Revisit only if a `cell` channel is ever wanted (needs a TL-B schema for the CAL variant). | **Closed — wallet-quirk row only.** No spec change. |
| D5 | Exec-spec §8.3; `cal-validator-design.md` §10.2 | Top-level `address` returned in **user-friendly base64url** by MyTonWallet 4.10.1 (`0Q…`, testnet non-bounceable) vs raw `0:hex` by Tonkeeper. `payload.from` is raw `0:hex` in BOTH; decoded hashparts match the account. | Validator must accept both `address` representations, OR key owner identity strictly off `payload.from` (raw in both wallets). | **Open — Observable, non-consensus.** First seen MyTonWallet 4.10.1, 2026-05-31. Spec wording PR deferred to post-quiet. |
| D6 | TonConnect SDK (`@tonconnect/sdk@3.4.1` via `ui@2.4.4`); relayer/tooling | SDK is **internally asymmetric about address form**: `connect` returns `account.address` raw `0:hex`, but `sendTransaction`'s validator requires **user-friendly base64url** (`isValidUserFriendlyAddress`). Feeding the connect address straight into a message → client-side `Wrong 'address' format in message at index 0` (pre-wallet). | Tooling/relayer must normalize raw→friendly (`toUserFriendlyAddress(addr, testOnly)`) before building messages. Harness fixed (gh-pages `d5cf2e1`). | **Open — Tooling, non-consensus, low PFC-1 impact** (§8.3 = signData/owner-sig channel, not the sendTransaction/W5-external channel). Not wallet-specific (SDK-level; reproduces on any wallet). Cross-links D5. |

**Repro for all rows:** Tonkeeper 4.7.0 (Chrome extension, testnet `-3`), `interop/dapp/index.html` served over ssh reverse tunnel, session `2026-05-30`. Full captures + signatures: `interop/observations/2026-05-30-tonkeeper.md`. Branch `post-pfc1/interop-smoke`.

Row legend (for future rows):
- **Wallet:** specific build / version
- **Repro:** test script + commit hash on `post-pfc1/interop-smoke`
- **Severity:** Cosmetic / Observable / Consensus-affecting
- **Action:** spec PR draft (post-quiet) or wallet-quirk row only

### 10.1 D1 classification slot

**Open question (highest-ROI next fact):** is D1 a property of the **TON Connect v2
signing model** (every TC v2 wallet does it) or **Tonkeeper-specific** behavior? One
observation cannot answer this. The slot below is filled per wallet; classification is
assigned only after ≥1 independent TC v2 implementation is observed.

**Current D1 status:** **`A — TC_V2_COMMIT_MODEL`** (assigned 2026-05-31, 2nd wallet =
MyTonWallet 4.10.1). Both Tonkeeper and MyTonWallet produce the same structured SignData commit
binding domain + timestamp; neither signs raw `payload.bytes`. D1 is a property of the TON
Connect v2 signing model, not Tonkeeper-specific. → §8.3 post-freeze clarification candidate:
validator must adopt the TC v2 SignData hash schema as canonical owner-sig verify. Spec PR
deferred (quiet period). Source: `interop/observations/2026-05-31-mytonwallet.md`.

**Comparison axes** (one column per wallet build; Tonkeeper column from
`interop/observations/2026-05-30-tonkeeper.md`):

| Axis | Tonkeeper 4.7.0 | MyTonWallet 4.10.1 | OpenMask | … |
|---|---|---|---|---|
| commit format | **VERIFIED** — see §10.2 (ed25519 holds) | **VERIFIED** — same layout, ed25519 holds | PENDING | |
| domain binding | yes — `domain_len` (u32be) + utf8(domain) inside commit + echoed top-level | yes — `ooopalladiumsb.github.io` (24B) inside commit + echoed top-level | PENDING | |
| timestamp inclusion | yes — `uint64_be(timestamp)` inside commit + echoed top-level | yes — inside commit + echoed top-level | PENDING | |
| payload hashing | sha256 over the structured commit — NOT raw bytes; `type` bound via `"txt"`/`"bin"` prefix | same — NOT raw; verified byte-exact | PENDING | |
| returned signature object | base64 64-byte Ed25519 + top-level `timestamp` / `domain` | base64 64-byte Ed25519 + top-level `timestamp`/`domain`; `address` in user-friendly base64url (D5) | PENDING | |

**Classification enum** (assign once a 2nd wallet column is filled):

- **A — `TC_V2_COMMIT_MODEL`** — all wallets produce the same structured commit. → D1 becomes
  a serious **post-freeze clarification candidate** for Exec-spec §8.3 (validator must adopt the
  TC v2 SignData hash schema as the canonical owner-sig verify routine).
- **B — `TONKEEPER_SPECIFIC`** — only Tonkeeper does this; others sign raw `payload.bytes`. → D1
  is an **interoperability note**, not protocol pressure; validator needs a per-wallet branch.
- **C — `WALLET_CLASS_VARIANCE`** — some wallets do, some don't, no clean TC-version line. → most
  consequential outcome: the owner-sig channel cannot assume a single verify routine; the spec
  must enumerate accepted commit schemas (or constrain the supported wallet set).

**Decision rule:** do not assign A/B/C — and do not draft any §8.3 spec PR — until the
MyTonWallet column (minimum) is captured. Quiet period: spec wins regardless; this slot only
records evidence.

### 10.2 D1 byte-exact commit layout — VERIFIED (Gate #1)

The structural tells (top-level `domain`/`timestamp` echo, type-dependent signature) gave the
**classification** (D1 → A). This section records the **byte-exact** layout, proven by
`ed25519_verify` passing against the real captures — the Freeze-gate-#1 hardening the two
observation sessions left undone. Reproduction: `interop/tc-v2-commit-reconstruct.mjs`
(Node built-in `crypto`, no deps, deterministic, offline).

The wallet signs, for `signData` of type `text`/`binary`:

```
message = 0xFFFF
        ‖ utf8("ton-connect/sign-data/")
        ‖ int32_be(workchain)
        ‖ address_hash[32]
        ‖ uint32_be(domain_len) ‖ utf8(domain)
        ‖ uint64_be(timestamp)
        ‖ ("txt" | "bin")                 # 3-byte per-type prefix
        ‖ uint32_be(payload_len) ‖ payload
verify  = ed25519_verify( sha256(message), signature, operator_pubkey )
```
- `text`  → prefix `"txt"`, `payload = utf8(text)`
- `binary`→ prefix `"bin"`, `payload = base64_decode(bytes)`

**Evidence:** `ed25519_verify` holds on **4/4 captures across 2 independent wallets**
(Tonkeeper 4.7.0 binary+text, MyTonWallet 4.10.1 binary+text) and **rejects** four negative
controls (corrupted sig, ts off-by-one, domain mismatch, wrong pubkey). The 3-byte `"txt"`/`"bin"`
prefix between `timestamp` and `payload_len` was the missing piece — a 6144-layout brute-force
without it found zero matches, including the otherwise-canonical guess.

**Honest caveat (documented residual, not a blocker):** all captures are workchain `0`, so
`int32` BE/LE of the workchain field are the identical `0x00000000`; this corpus cannot
distinguish workchain endianness. This is likely **un-testable via normal wallets** (standard
TON user wallets deploy only in workchain 0; masterchain `-1` has no штатный dApp path), so it
is treated as a residual backed by canonical SDK source rather than chased: the reference impl
(`ton-connect/demo-dapp-with-react-ui` → `src/server/services/sign-data-service.ts`) uses
`writeInt32BE`, which the verifier pins. Full framing + the post-quiet normative package this
feeds: `docs/notes/tc-v2-signdata-verify-v1.md`.

**Consequence (unchanged, deferred):** the validator's owner-sig verify (cal-validator-design
§8.1) must adopt THIS commit as the canonical routine; it cannot call
`ed25519_verify(payload_bytes, sig, pubkey)`. Spec PR for §8.3 still deferred (quiet period) —
this section is observation evidence, not a spec amendment.

---

## 11. Tooling roadmap (post-skeleton)

To populate this matrix we need, in order:

1. **`interop/` directory** — Node TS shims using `@tonconnect/sdk`.
2. **`interop/sign-message.mjs`** — open TC session, send a fixed canonical CAL,
   capture signMessage response, verify against operator's published pubkey.
3. **`interop/ton-proof-roundtrip.mjs`** — initiate connection, capture
   ton_proof, verify signature server-side, persist proof.
4. **`interop/replay-edges.mjs`** — exercise `valid_until` boundary cases.
5. **`interop/size-sweep.mjs`** — sweep payload sizes, log wallet acceptance.

Each shim writes an observation log under `interop/observations/<wallet>/<date>.json`.
Aggregation script (TBD) collates these into the per-section "Observed" columns
of this matrix.

The live-session shims (1–5) do not exist yet — this section is the scaffold for what gets
built next on `post-pfc1/interop-smoke`. **Landed so far:** `interop/tc-v2-commit-reconstruct.mjs`
— offline ed25519 verification of captured `signData` responses; reconstructs the §10.2
commit layout from existing observation captures (not a live-session shim).

---

## 12. References

- Spec contract: `docs/spec/execution-spec-v1.md` §8.3, §8.4
- Design depth: `docs/notes/ton-connect-ingress-design.md`
- Identity invariants: `docs/notes/cal-validator-design.md` §10
- TON Connect v2 spec: https://docs.ton.org/applications/ton-connect/core-concepts
- W5 contract spec: https://docs.ton.org/blockchain-basics/standard/wallets/v5
- TC SDK: https://github.com/ton-connect/sdk
