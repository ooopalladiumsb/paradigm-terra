# PP#4-B anchor broadcast harness (Путь 2 — TON Connect, manual confirm)

One-shot TON Connect `sendTransaction` harness that broadcasts the **pinned** Multisig STATE_ROOT anchor to
**ton-testnet**. The operator key never leaves the wallet — you confirm the transaction yourself.

This is the live half of `docs/notes/pp4-b-gate.md §3`. Everything it sends is fixed offline and verified
client-side before the button enables.

## Pinned payload (must match `pp4-b-gate.md §2.1`)

```
operator (self)   0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j  (raw 0:28f02e39…c1b8, non-bounceable testnet)
state_root        0x4a14f8f11f37657e62aa6670822a18544fe1fea560aac17f16cd9234efc4d4f0
body cell hash    0x79543a1b015462d0920125b5e41eb5c57f38b2f7d7a243fb689f13e5a103d0bc
body BoC (b64)    te6cckEBAQEAJgAASFBUQTFKFPjxHzdlfmKqZnCCKhhUT+H+pWCqwX8WzZI078TU8AQJrCo=
value             0.05 TON (self-send; returns to operator minus fees)
```

## Built-in safety guards (broadcast button stays disabled unless ALL pass)

1. The `BODY_BOC` re-hashes locally to the pinned `BODY_HASH` (no drift).
2. The connected wallet is on **testnet** (chain `-3`).
3. The connected wallet **is** the pinned operator address.

## Run

Single static file, no build step.

```
cd pp2/anchor-broadcast
python3 -m http.server 5173
```

- **Desktop:** open `http://localhost:5173/`, use the Tonkeeper **browser extension** in **testnet** mode.
- **Mobile Tonkeeper:** mobile wallets require a **public HTTPS** manifest URL — `localhost` is rejected.
  Serve this directory on a public HTTPS origin (e.g. the project's `gh-pages` export discipline) and set
  `manifest.json`'s `url` to that origin before connecting.

Then: **Connect wallet** → verify the green "testnet + operator + body hash verified" line →
**Broadcast anchor**. Confirm in the wallet (it shows an "unknown payload" — that is the anchor cell).

## After broadcast

The harness prints the signed external-message BoC + its hash. Open
`https://testnet.tonviewer.com/0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j`, find the new tx, confirm
its message body == `0x4a14…d4f0`, and **send the tx hash back** — that closes runbook §3 step 5, then
evidence (step 6) + the freeze ruling are recorded.
