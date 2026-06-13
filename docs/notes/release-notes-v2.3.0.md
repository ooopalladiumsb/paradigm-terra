# Release notes — v2.3.0 (Layer 3 Stage-A)

**Date:** 2026-06-13 · **Line:** 2.x (above the Freeze Surface) · **Tag:** `v2.3.0`

A **MINOR** release: **Layer 3 Stage-A** — on-chain read-model projections of governance / oracle / PTRA —
plus the live closure of the v2.x operational contour. No freeze line changes: `freeze-gate` byte-identical
throughout (Tier-M, ratified **Staged** framing).

## The framing it encodes — Staged (ratified)

```
Stage-A (this release): on-chain contracts REFLECT the frozen off-chain governance/oracle/PTRA state,
                        they never decide. Tier-M, like Layer 2.
Framing B (deferred):   the on-chain ECONOMY — NFT-slot voting+tally+timelock, oracle aggregation+slashing,
                        a real PTRA token + on-chain staking/emission — is the reserved PFC-3 / v3.0.0.
```
The off-chain frozen consensus already decides these (§2.3 actions); Stage-A projects that state on-chain.

## What shipped (`tolk/`)

| Component | Contract | Invariant | Golden codeHash |
|---|---|---|---|
| **L3.1** Governance view | `governance-view.tolk` | reflects tallies, never votes | `B67985C6…` |
| **L3.2** Oracle view | `oracle-view.tolk` | reflects feeds, never aggregates | `DEE68103…` |
| **L3.3** PTRA view | `ptra-view.tolk` | reflects balances, never mints/stakes | `61930FA7…` |
| Genesis | `src/genesis.ts` | now deploys **8** read-models (L2 five + these 3) | (manifest) |

Every contract: owner-gated projection write, byte-identical read-back, a non-owner write aborts **401**,
and **no decision op exists** — any unknown op aborts **0xffff** (the invariant is proven per contract, with
the sharpest cases: an inconsistent governance tally/status stored verbatim; an oracle re-upsert that
replaces rather than averages; a PTRA balance that can move *down*). Harness suite 41/41.

## Also in this release — v2.x operational contour CLOSED (live on ton-testnet)

- **PP#5-B SETTLED** — live `wallet.send_nft`: deployed the standard TEP-62 collection, minted item #0 to
  the operator, drove OUR `send_nft` → owner flipped operator → recipient (tx `687c7d70…`). Completes the
  `wallet.*` live-proof line (send_ton / send_jetton / send_nft).
- **Genesis-B SETTLED** — one W5 external deployed all 5 Layer-2 read-models live (tx `78ffc1ea…`).
- Reliable broadcast method established (`pp2/scripts/{pp5b,genesisb}-send-local.ts`): local sign at the
  live seqno + 1-hour window + toncenter relay, after the wallet TON-Connect path produced stale-seqno signatures.

## Scope / limits

- Offline release: every contract is build- + sandbox-proven. **Live testnet deploy** of the Stage-A suite
  is a separate GATED step (extend `genesisb-send-local.ts` for the 8-contract manifest; funded publisher).
- The on-chain governance economy (decisions/voting/token) is **Framing B = PFC-3 = a future MAJOR v3.0.0**,
  its own freeze line and charter — not in 2.x.

## Pointers
- Charter: `docs/notes/layer3-charter.md` (Staged framing + per-component DoD)
- CHANGELOG: `[2.3.0]`
- Package: `tolk/` (`@paradigm-terra/tolk-harness`); manifest `tolk/artifacts/genesis/genesis-manifest.json`
