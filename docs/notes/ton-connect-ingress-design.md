# TON Connect ingress — design note (Execution Spec v1 §8.3, CAL Spec §8.5)

## 1. Purpose & position

TON Connect v2 is the normative ingress channel for owner signatures on CAL
payloads. This note captures the full technical depth: what gets signed, how
`ton_proof` binds the domain, how the TON Connect replay model unifies with CAL
nonce/expiration, and what is explicitly out of consensus.

It does **not** define on-chain publication of validated CAL (W5 external via
`sendTransaction`) — that path requires the on-chain Registry contract and is
deferred. See §6.

## 2. Architecture

```
┌──────────┐  signMessage(canonical_bytes(CAL))    ┌──────────────┐
│ Wallet   │ ◄──────────────────────────────────── │ Orchestrator │
│ (V5/SBT) │  owner_sig:bytes64                    │              │
│          │ ─────────────────────────────────────►│ ─────────────┼─► validator
└──────────┘                                       └──────────────┘
     ▲                                                    │
     │ ton_proof (once per session)                       │
     └────────────────────────────────────────────────────┘
                                       store as
                                       state.registry.agents[id].owner_proof_domain
```

Boundaries:

- **Owner ↔ Wallet:** out of scope (UI of the wallet app).
- **Wallet ↔ Orchestrator:** TON Connect HTTP bridge or JS bridge. NaCl
  `crypto_box` encrypted; bridge is operated by the wallet provider; **all
  bridge state is out of consensus**.
- **Orchestrator ↔ Validator:** in-process or RPC; CAL is fully assembled
  (operator_sig + owner_sig populated) before `validate()` is called.

## 3. Signed payload

`signMessage` is invoked with:

```jsonc
{
  "type":    "binary",
  "data":    "<base64(canonical_bytes(cal_without_signatures))>",
  "network": "-239",           // mainnet; -3 for testnet
  "from":    "<owner wallet TON address, user-friendly form is OK here>"
}
```

- `canonical_bytes(cal_without_signatures)` is the same byte stream defined in
  CAL Spec §8.3 — same as for `operator_sig`. There is no separate "Connect
  envelope" hashed into `CAL_HASH`.
- `network` and `from` are TON Connect-side metadata that the wallet renders for
  user confirmation. They are **not** part of `CAL_HASH` and the validator
  **MUST NOT** read them.
- The wallet returns an `Ed25519` signature of the raw `data` bytes. The wallet
  may prepend its own domain-separator internally (per TON Connect §6), but for
  `signMessage(binary)` the spec mandates raw-byte signing — verify with the
  wallet implementation before relying on this.

## 4. `ton_proof` and domain binding

When the user first connects their wallet to the orchestrator (or to any dApp
acting as orchestrator UI, e.g. `agents.ton.org`), the orchestrator requests a
`ton_proof`:

```jsonc
{
  "type":    "ton_proof",
  "payload": "<random 32-byte nonce, base64>"
}
```

The wallet returns:

```jsonc
{
  "name":      "ton_proof",
  "proof": {
    "timestamp":  1717000000,
    "domain":     {"lengthBytes": 14, "value": "agents.ton.org"},
    "signature":  "<base64 Ed25519>",
    "payload":    "<echoes the requested nonce>"
  }
}
```

The orchestrator verifies the signature per TON Connect §6 (the signed message
is a fixed-prefix construction over `domain || timestamp || payload || address
|| workchain`) and persists:

```
state.registry.agents[agent_id].owner_proof_domain := {
  domain:     "agents.ton.org",          // governance-approved origin
  pubkey:     <owner wallet public_key, raw 32 bytes>,
  proof_sig:  <bytes64>,                 // the ton_proof signature
  valid_from: <tick at which ton_proof was admitted>
}
```

**Validator invariant.** At every CAL with `action ∈ OWNER_REQUIRED_ACTIONS`:

```
signatures.owner_sig.pubkey
  MUST byte-equal
state.registry.agents[agent_id].owner_proof_domain.pubkey
```

Mismatch → `cal.failed` with `CAPABILITY_DENIED` (same code as missing
`owner_sig` — the validator treats unbound owner signatures as absent for
gating purposes; the `reason_detail` off-chain log distinguishes).

The orchestrator MAY refresh `ton_proof` periodically (e.g. on session
re-establishment). Replacement is an `agentic.rebind_owner_proof` CAL,
itself an `OWNER_REQUIRED_ACTIONS` member — i.e. only the current owner can
authorize binding to a new domain or wallet.

## 5. Replay model unification

TON Connect carries its own replay-state (`id`, `valid_until`, session nonce).
CAL carries `nonce` and `expiration_tick`. They are **non-redundant** — each
protects a different layer:

| Layer | Replay primitive | Authority |
|-------|------------------|-----------|
| TC bridge (orchestrator ↔ wallet) | `id` strictly increasing per session | TON Connect |
| TC request `valid_until` | unix-ts cutoff for wallet signing | TON Connect |
| CAL `nonce` | per-agent strictly +1 | CAL Spec §6.2 — consensus |
| CAL `expiration_tick` | tick cutoff for validator admission | CAL Spec §3.4 — consensus |

Orchestrator alignment rule:

```
TC_request.valid_until := unix_ts_at_tick(cal.expiration_tick)
TC_request.id          := session_local_monotonic   // NOT cal.nonce
```

Rationale for keeping TC `id` distinct from CAL `nonce`: TC `id` exists to
order requests within one bridge session; CAL `nonce` is a global,
cross-session ordering invariant per-agent. Coupling them would force a new TC
session per CAL, defeating session reuse.

**What never enters STATE_ROOT:**
- TC `id`
- TC `valid_until`
- bridge session keys
- bridge message nonces
- bridge TTLs

The validator's pure function `(cal, snapshot, trace) → events` already has no
TC-state in its inputs; consistency is automatic.

## 6. Future work

### 6.1. `sendTransaction(W5 external)` publication

Publishing a validated CAL on-chain as a W5 external is the natural completion
of the pipeline. The body layout per Wallet V5 spec:

```
wallet_id(32)   = cal.agent_id
valid_until(32) = unix_ts_at_tick(cal.expiration_tick)
msg_seqno(32)   = cal.nonce
inner           = canonical_to_inner(cal.action, cal.steps)
signature(512)  = cal.signatures.operator_sig
```

This requires:

1. A normative codec **`canonical_to_inner`** — CAL action/steps → W5
   `InnerRequest`. Decision point: emit as `OutList` (one `SendMessage` per
   step) or as `ActionList` (extension actions). Goes into CAL Spec Annex F.
2. An on-chain **Registry contract** that observes published externals and
   mirrors `cal.finalized` events into `state` (closing the off-chain → on-chain
   loop).
3. A new failure code `INGRESS_REJECTED` in CAL Spec §3.5 for the case where
   the wallet refuses to broadcast (no funds, user cancel) — the CAL was
   already `VALIDATED`, so the bill is post-VALIDATED, but no `cal.executed`.

None of this is in scope for the current patchset. Until the Registry exists,
"publication" is implementation-defined and may be skipped entirely (validator +
event log is enough for off-chain consensus).

### 6.2. Multi-owner wallets

The TON Connect flow assumes a single owner key per `agent_id`. For Multisig v2.1
ownership (M-of-N), each co-signer goes through the same `signMessage` flow,
and the orchestrator aggregates signatures before calling `validate()`. CAL Spec
§8 already supports multi-sig via the `Signatures` object's repeat structure;
no protocol change needed, only an orchestrator UX concern.

### 6.3. Hardware wallets

Ledger and other hardware paths flow through the same `signMessage` RPC at the
wallet-app layer. No protocol-level change required.

## 7. Out of scope

- TON Connect bridge protocol internals (transport, encryption, session
  re-keying) — already normative in [TON Connect docs](https://docs.ton.org/applications/ton-connect/core-concepts).
- UI / UX of `signMessage` confirmation in wallets — non-normative.
- TON Connect `signData` (currently unused; reserved for future profile actions
  that sign auxiliary blobs, not CAL bytes).

## 8. References

- [TON Connect core concepts](https://docs.ton.org/applications/ton-connect/core-concepts)
- [Wallet V5 spec](https://docs.ton.org/blockchain-basics/standard/wallets/v5)
- [Agentic Wallets](https://docs.ton.org/overview/ai/wallets)
- CAL Execution Spec v0.1.0-draft §8 (signing model)
- Execution Spec v1 §8 (implementation requirements)
- [[cal-validator-design]] §10 (W5 ↔ CAL isomorphism)
