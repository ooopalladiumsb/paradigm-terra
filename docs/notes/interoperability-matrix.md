# Interoperability matrix — TON Connect / W5 / paradigm_terra

**Status:** Scaffold (post-PFC-1, exploratory). Not normative. Tracks empirical
results from real-wallet integration smoke testing of the PFC-1 transport
contract (`docs/spec/execution-spec-v1.md` §8.3 + `docs/notes/ton-connect-ingress-design.md`).

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
| Tonkeeper | mobile + browser ext | W5 (`v5r1`) | ✓ | ✓ | not yet tested |
| MyTonWallet | browser ext + mobile | W4 default, W5 supported | ✓ | ✓ | not yet tested |
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
| Does the wallet sign the raw `data` bytes verbatim, or prepend a wallet-domain prefix internally? | Raw per TC v2 §6 for `binary` | TBD |
| Does the wallet render a human-readable preview of the CAL JSON when `type=binary`? | "Unknown binary" or hex | TBD |
| Max accepted `payload.data` size? | ≥ 4 KiB (informal) | TBD |
| Does refusing → cancel surface as an RPC error or silent timeout? | Error per TC §3.2 | TBD |
| Returned signature encoding — hex vs base64? | base64 per TC §6 | TBD |

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
| `domain.lengthBytes` correctness on multi-byte domains (e.g. IDN)? | Bytes, not chars | TBD |
| `timestamp` clock skew tolerance accepted by wallets? | ±300 s informal | TBD |
| Does the wallet refresh `ton_proof` automatically on reconnect, or require a new request? | Per TC: new request | TBD |
| What does the wallet return for `payload` echo — verbatim base64, or decoded? | Verbatim | TBD |
| Does `ton_proof` returned `address` use raw `0:<hex>` or user-friendly form? | User-friendly per TC | TBD |

**Validator-side invariant** (PFC-1 §10.2 of `cal-validator-design.md`): the
pubkey extracted from `ton_proof` MUST byte-match
`state.registry.agents[id].operator_pubkey` raw 32 bytes. User-friendly forms
in the TC envelope are stripped before comparison.

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
| Behavior at exactly 4 KiB / 8 KiB / 16 KiB? | Three boundary tests | TBD |
| Does the wallet truncate signing input silently? | Hopefully not | TBD |
| Does W5 external body have its own size cap before TC throws? | TC bridge limit ~64 KiB informal | TBD |

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
| `ton_proof` re-issuance on every reconnect, or only on session TTL expiry? | Spec silent | TBD |
| Does the wallet expire `ton_proof` independently of TC session TTL? | Possibly | TBD |
| If orchestrator drops bridge mid-session, can it resume with same `client_id`? | Per TC: yes | TBD |

---

## 10. Cross-cutting: spec divergences observed (running log)

| # | Section | Observed deviation | Spec clarification candidate | Status |
|---|---|---|---|---|
| — | (none yet) | — | — | — |

When a row is added here, it gets:
- **Wallet:** specific build / version
- **Repro:** test script + commit hash on `post-pfc1/interop-smoke`
- **Severity:** Cosmetic / Observable / Consensus-affecting
- **Action:** spec PR draft (post-quiet) or wallet-quirk row only

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

None of this exists yet — this section is the scaffold for what gets built next
on `post-pfc1/interop-smoke`.

---

## 12. References

- Spec contract: `docs/spec/execution-spec-v1.md` §8.3, §8.4
- Design depth: `docs/notes/ton-connect-ingress-design.md`
- Identity invariants: `docs/notes/cal-validator-design.md` §10
- TON Connect v2 spec: https://docs.ton.org/applications/ton-connect/core-concepts
- W5 contract spec: https://docs.ton.org/blockchain-basics/standard/wallets/v5
- TC SDK: https://github.com/ton-connect/sdk
