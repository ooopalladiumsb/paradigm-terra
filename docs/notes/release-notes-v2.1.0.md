# Release notes — v2.1.0 (wallet.send_nft)

**Date:** 2026-06-12 · **Line:** 2.x (above the Freeze Surface) · **Tag:** `v2.1.0`

A **MINOR** release: the `wallet.send_nft` publication path (TEP-62), the third `wallet.*` verb after
`send_ton` (v1.0.0) and `send_jetton` (v1.1.0). No freeze line changes — the consensus already finalizes
`send_nft` via the generic validator/reducer/gas (`nft_access` scope); only the §8.3 publication codec was
missing. `freeze-gate` byte-identical (touches neither PFC-1 nor PFC-2 normative surface).

## What shipped

- **IR codec** — `encodeSendNft` (`orchestrator/src/w5/canonical-to-inner.ts`) → one `action_send_msg`
  carrying a TEP-62 `transfer` (op `0x5fcc3d14`).
- **BoC codec** — `nftBodyToCell` / `cellToNftBody` (`pp2/src/ir-to-boc.ts`) with offline round-trip.

## TEP-62 vs TEP-74 (the two differences)

1. **No amount.** An NFT item is indivisible — the whole item moves to `new_owner`. The body has no
   quantity field, so the ⊆ rule binds the item + owner, not an amount.
2. **No master-derivation.** A jetton transfer goes to the agent's derived jetton wallet (unresolved `""`
   in the IR); an NFT transfer goes **directly to the NFT item contract** (`dest = nft_item`), resolved at
   the IR layer with no `get_wallet_address` hop.

## Authorization (⊆ rule)

Faithful destination item + new owner (no redirection), attached TON = `forward_amount + 0.05 TON` (the
only TON authorized to leave), exact-value send mode (never the carry-remaining / carry-all bits). The
transfer bounces, so a failed item hop returns the TON.

## Scope / limits

- Offline increment: the codec + round-trip are proven offline (orchestrator 128/128, pp2 29/29).
- **PP#5** (live ton-testnet end-to-end: deploy a standard TEP-62 item, drive `send_nft`, observe the owner
  change) is the network-gated follow-on, gated like PP#3 / PP#4-B on a funded operator — **not** in v2.1.0.
- Non-goals: `custom_payload` / `forward_payload`, NFT mint/burn, collection deploy.

## Pointers
- Semantics: `docs/notes/send-nft-semantics.md`
- CHANGELOG: `[2.1.0]`
- Tests: `orchestrator/test/send-nft-codec.test.ts`, `pp2/test/send-nft-boc.test.ts`
