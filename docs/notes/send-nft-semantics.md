# wallet.send_nft — publication semantics (TEP-62)

**Date:** 2026-06-12 · **Tier-M** (above the Freeze Surface, §8.3 publication layer — the consensus already
finalizes `wallet.send_nft` via the generic validator/reducer/gas; `nft_access` scope, `dsl/src/taxonomy.ts`).
Mirrors `pfc2-1-send-jetton-semantics.md`. Targets a MINOR release (**v2.1.0**). The `freeze-gate` stays
byte-identical (nothing here touches a normative artifact).

## What this adds

A body encoder for `wallet.send_nft`, completing the third `wallet.*` verb after `send_ton` (v1.0.0) and
`send_jetton` (v1.1.0):

- **IR:** `orchestrator/src/w5/canonical-to-inner.ts` — `encodeSendNft` → one `action_send_msg` carrying a
  TEP-62 `transfer` body.
- **BoC:** `pp2/src/ir-to-boc.ts` — `nftBodyToCell` / `cellToNftBody`, with offline round-trip
  (IR → BOC → IR').

## TEP-62 mapping

```
transfer#5fcc3d14 query_id:uint64 new_owner:MsgAddress response_destination:MsgAddress
  custom_payload:(Maybe ^Cell) forward_amount:(VarUInteger 16) forward_payload:(Either Cell ^Cell)
```

Two differences from the jetton (TEP-74) path:

1. **No amount.** An NFT item is indivisible — the whole item moves. The body has no `amount` field; the
   ⊆ rule therefore binds only the destination item and the new owner, not a quantity.
2. **No master-derivation.** A jetton transfer goes to the agent's *jetton wallet* (derived from
   `jetton_master` + agent via `get_wallet_address`, left unresolved `""` in the IR). An NFT transfer goes
   **directly to the NFT item contract** — `dest = nft_item` is the agent-supplied param, resolved at the
   IR layer. There is no network-leg resolution hop.

## Params

```
nft_item              required — the NFT item contract (the message dest)
new_owner             required — the NFT's new owner (⊆: faithful, no redirection)
query_id              required-explicit (uint64; never auto-generated)
response_destination  optional ⇒ defaults to the agent (sender)
forward_amount        optional ⇒ 0 (nanoTON forwarded to new_owner on success)
forward_payload       optional ⇒ absent
```

Attached TON value = `forward_amount + NFT_TRANSFER_TON` (0.05 TON bounded gas for the item hop) — the only
TON authorized to leave; the send mode is exact-value (never the carry-remaining / carry-all bits). The
transfer message bounces (a failed item hop returns the TON).

## Non-goals (this increment)

- `custom_payload` / `forward_payload` are **fixed-absent** (as with jetton).
- NFT **mint / burn**, collection deploy, and item-content edits — out of scope.
- **PP#5 (live testnet)** — the on-chain end-to-end proof (deploy a standard TEP-62 item, drive
  `send_nft`, observe the owner change) is the network-gated follow-on, gated like PP#3/PP#4-B on a funded
  operator. Not done in this offline increment; the codec + round-trip are proven offline here.

## Tests

- `orchestrator/test/send-nft-codec.test.ts` — IR projection, ⊆, defaults, malformed-param rejection, and
  send_ton/send_jetton regression (12 checks).
- `pp2/test/send-nft-boc.test.ts` — byte-faithful round-trip, the "no amount" assertion, jetton↔nft op
  dispatch, and boundary values (6 checks).
