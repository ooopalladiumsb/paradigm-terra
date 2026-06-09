# interop dApp — minimal observational harness

Phase-1 observational dApp for the post-PFC-1 interop track. Anchor `7n5ywp`.
Discipline anchor `z3h0ix`:

> **PFC-1 defines the protocol. This page observes reality.**

This is **not** a validator, orchestrator, or execution engine. It is a single
static HTML page that opens a TON Connect v2 session, issues the RPC calls of
interest, and records every observable wallet response into a structured log
that gets exported as JSON.

The exported logs land in `interop/observations/<wallet>/<date>.json` and feed
the `docs/notes/interoperability-matrix.md` rows.

## Running locally

The dApp is a single file with no build step. Any static HTTP server works:

```
cd interop/dapp
python3 -m http.server 5173
```

Then open `http://localhost:5173/` in a browser, click **Connect wallet**, and
follow the TON Connect modal.

**Manifest URL.** `manifest.json` ships with `url = http://localhost:5173`.
Mobile wallets (Tonkeeper, Tonhub) typically require a publicly-reachable
HTTPS manifest URL; for first-pass desktop browser-extension testing
(Tonkeeper extension on Chrome, MyTonWallet) localhost is fine.

To test against a mobile wallet, host this directory on any HTTPS endpoint and
point `manifestUrl` (in `index.html`) at the public copy. A GitHub Pages
branch under `ooopalladiumsb/paradigm-terra` is the lowest-friction route.

## What it does

1. **Connect** — `tc.openModal()`, captures `wallet.device.*` and
   `wallet.account.*`, requests `ton_proof` with a random 32-byte nonce.
2. **ton_proof panel** — renders the raw proof object if returned, or the
   error if rejected.
3. **Sign panel** — toggle between `signData` and `signMessage` RPC methods,
   pick `payload.type ∈ {binary, text, cell}`, supply the payload bytes
   (default: a sample canonical JSON array, base64-encoded).
4. **Send panel** — optional `sendTransaction` to self with 1 nanoTON, useful
   for observing the full W5 external publication path.
5. **Log** — every observed event (`status_change`, `ton_proof_received`,
   `sign_request`, `sign_response`, `sign_error`, etc.) is appended with a
   millisecond timestamp.
6. **Export** — downloads the full session as
   `<wallet>_<date>_<short-uuid>.json`.

## What it doesn't do

- No validation of CAL contents.
- No signature verification against `operator_pubkey` (that lives in the
  validator; this page is observational only).
- No retry logic, no session persistence, no orchestration.
- No multisig, no batching.

If the page tries to do any of that, it has drifted from anchor `7n5ywp` and
the drift is itself a divergence to record.

## Observation schema

```jsonc
{
  "session_id": "uuid",
  "started_at": "iso8601",
  "exported_at": "iso8601",
  "tc_lib": "@tonconnect/ui@<pinned version>",
  "wallet": {
    "name": "Tonkeeper" | "MyTonWallet" | ...,
    "version": "<wallet's appVersion>",
    "platform": "iphone" | "android" | "browser" | ...,
    "max_protocol_version": 2 | ...,
    "features": [ ... ],     // raw advertised features array
    "account_address_raw": "0:...",
    "account_chain": "-3" | "-239",
    "public_key_hex": "<64 hex chars or null>"
  },
  "features": {
    "signData_supported":         true | false | null,
    "signMessage_supported":      true | false | null,
    "sendTransaction_supported":  true | false | null,
    "ton_proof_supported":        true | false | null
  },
  "events": [
    { "ts": "...", "kind": "ready" },
    { "ts": "...", "kind": "init", "manifestUrl": "..." },
    { "ts": "...", "kind": "connect_request", "ton_proof_payload_b64": "..." },
    { "ts": "...", "kind": "status_change", "connected": true, "wallet_name": "Tonkeeper" },
    { "ts": "...", "kind": "ton_proof_received", "proof": { ... } },
    { "ts": "...", "kind": "connected", "wallet": { ... } },
    { "ts": "...", "kind": "sign_request", "method": "signData" | "signMessage", "payload": { ... } },
    { "ts": "...", "kind": "sign_response", "method": "...", "latency_ms": 1234, "response": { ... } },
    { "ts": "...", "kind": "sign_error",    "method": "...", "latency_ms":   12, "message": "...", "code": null },
    { "ts": "...", "kind": "disconnected" },
    { "ts": "...", "kind": "exported", "filename": "...", "event_count": 17 }
  ]
}
```

The matrix consumes these directly — each section in
`docs/notes/interoperability-matrix.md` fills its "Observed" columns from the
relevant `kind`s in these logs.

## Why both `signData` and `signMessage`?

PFC-1/B spec (Execution Spec §8.3) describes the owner-sig ingress as
`signMessage` with `payload.type = "binary"`. TON Connect's documented RPC for
that shape is more commonly `signData`. We do not know yet which actual
wallets implement either, both, or neither — this is an open observation
point in `interoperability-matrix.md` §2.

This dApp deliberately offers both and logs which fails how. The result is a
divergence row, not a spec change during quiet period.

## What's intentionally absent

- A `package.json` and `node_modules`. The CDN import keeps the harness
  reviewable from a single `view-source` and avoids supply-chain surface area
  in this phase.
- A build step, a bundler, a framework. If we need any of these the harness
  has outgrown Phase-1 scope.
- Any wallet-specific code. The dApp must behave identically against any
  TC v2 wallet; wallet-specific behavior belongs in the observation log, not
  the code.

## Pinned versions

| Dep | Pin | Why |
|---|---|---|
| `@tonconnect/ui` | `2.1.0` (via `esm.sh`) | Reproducibility; observations include the pin in `tc_lib` |

If the pinned version is bumped, prior observation logs remain valid (the pin
is recorded in each session); the new pin gets its own column when matrix
results diverge across versions.

## Next steps once observations start landing

1. First session → first row in `interop/observations/tonkeeper/`.
2. Fill matrix §1, §2, §3 (wallet candidates, signMessage, ton_proof) from
   one Tonkeeper session.
3. Repeat for MyTonWallet, Tonhub.
4. Cross-tabulate divergences in matrix §10 (running log).
5. Only then consider what spec clarifications (if any) belong on
   `feat/orchestrator-track-b` as quiet-period bugfix-class PRs.

See `docs/notes/interoperability-matrix.md` for the full target shape.
