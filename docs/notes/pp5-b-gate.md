# PP#5-B Gate — pre-broadcast checkpoint (live send_nft proof)

**Date:** 2026-06-13 · **Status:** gate / pre-registration. The checkpoint that must hold BEFORE the
irreversible ton-testnet transactions of PP#5-B. Publication layer (§8.3) — **no Freeze Surface**
(`send_nft` shipped v2.1.0). Follows the PP#3-B/PP#4-B discipline: fix reproducibility, the operational
prerequisites, the expected effect, and the resume plan in advance, so the broadcast is a confirmation,
not a discovery. **Nothing here touches the network** — the live steps are §3, gated on §2.

## 0. What PP#5-B confirms

PP#5 (R1, `pp5-nft-proof.md`) is proven OFFLINE against the real official-standard TEP-62 NFT in
`@ton/sandbox`. PP#5-B does the same end-to-end on **ton-testnet**: deploy the standard collection, mint
item #0 to the operator, then drive OUR `send_nft` — and observe the item's owner flip operator → recipient.

```
observable (read-only):  ITEM.get_nft_data().owner_address :  operator  →  recipient
```

An NFT settles by OWNERSHIP, not balance — the proof is the owner field, not a numeric delta.

## 1. Reproducibility evidence (pinned, from R1)

```
nft standard      ton-blockchain/token-contract/main/nft (official TEP-62), vendored verbatim; func-js 0.11.0
collection code   8e5aab17e2e503bec75c2f453b9dacf11a98bbb2cc202994710952a7271c7780   (pp2/contracts/nft/nft-compiled.json)
item code         ba4d975d2b66231c1f0a0ccca6e8ff8f7ba0610c4b7639584b8e98303dc3128c
send_nft codec    pp2/src/ir-to-boc.ts nftBodyToCell (op 0x5fcc3d14); v2.1.0
offline proof     pp2/test/pp5-sandbox.test.ts — owner flips operator→recipient; non-owner → exit 401
reference body    pp2/artifacts/pp5/pp5-plan.json — cell hash 0xc19cb8f2…  (determinism anchor; the LIVE
                  body uses the real recipient — re-derive + re-pin in §2 before broadcast)
```

## 2. Operational prerequisites — REQUIRED before §3 (operator-supplied; NOT done here)

These are the items the offline work cannot produce. **PP#5-B does NOT open until every box is checked:**

```
[x] funded ton-testnet operator wallet — 0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j
      (raw 0:28f02e39…c1b8), active ~1.9 TON (the PP#4-B operator, reused)
[x] key custody — PATH 2 (TON Connect, manual confirm in wallet)
[x] recipient (new NFT owner) — 0QD6xP-v3wm4O6uV-PxXl6vVFFvEMg4C7kHiLFrV-3PyaF4Q (raw 0:fac4ffaf…f268)
[x] re-derived + pinned for the real operator/recipient (pp2/artifacts/pp5/pp5b-plan.json, query_id 880013):
      · collection address  0:c72cdb972e8c80d295680cd9763d3c4cf1bc79d99f31198ac1956f8a8c3dd3e6
      · item #0 address     0:151ff7bea548ccdaac92c3c7f38f50a4f8701dcd30c22b719bda1801fa4b4dbb
      · send_nft body hash  0x50d1521c741bb06eb3de2a5e6ff697477cff260e67206d8b1f87ae7b5b797d45
[x] sandbox confirmation — pp2/scripts/pp5b-plan.ts: the EXACT builders deploy+mint+send_nft → owner flips
    operator→recipient; item address == collection get_nft_address_by_index(0). pp2 suite 32/32.
```

All boxes checked — §3 is OPEN. The two live steps (deploy+mint, then send_nft) are the only acts left,
performed by the operator via the Path-2 harness (gh-pages `/pp5b/`); this repo writes no evidence until a
real on-chain owner-flip is observed.

## 3. PP#5-B runbook (the live steps — GATED on §2)

```
Step  Action                                                      Irreversible?
1     read-only: confirm operator wallet active + funded          no
2     deploy the standard NFT collection (owner=operator)         YES — tx (idempotent: skip if deployed)
3     mint item #0 to the operator (collection op=1 deploy)       YES — tx (idempotent: skip if item owned)
4     read-only: assert get_nft_data(item).owner == operator      no
5     PRE-BROADCAST GATE: re-derive the send_nft body; assert its no (the last off-ramp)
      cell hash == the §2 pinned value
6     BROADCAST OUR send_nft from the operator → item             YES — the single proof tx
7     observe: get_nft_data(item).owner == recipient              no (read; "inspect before classifying")
8     record evidence → pp2/artifacts/pp5/pp5b-evidence.json      no (idempotent write)
```

## 4. Roll-forward / resume plan (idempotency)

| Step | Irreversible? | Resume rule |
|---|---|---|
| 2 deploy collection | YES | deterministic address — if already active, treat as done |
| 3 mint item | YES | if item #0 already owned by operator, skip to §3.5 |
| 5 pre-broadcast gate | no | the last off-ramp — abort if the body hash drifts |
| 6 send_nft | YES | guard: run once; if the item already shows the recipient, treat as settled |
| 7 observe | no | the OBSERVED on-chain owner decides, not the broadcast call |

Steps 2/3/6 are on-chain txs but each is observable + idempotent: an interrupted run resumes by inspecting
the chain (PP#2 §3.1 "inspect before classifying").

## 5. Evidence package structure (`pp2/artifacts/pp5/pp5b-evidence.json`)

```json
{
  "result": "PP#5-B SETTLED",
  "network": "ton-testnet",
  "framing": "live wallet.send_nft (TEP-62) — owner flips operator → recipient",
  "operator": "<owner/sender>", "recipient": "<new owner>",
  "collection": { "address": "<addr>", "code_hash": "8e5aab17…" },
  "item": { "index": 0, "address": "<addr>" },
  "send_nft": { "op": "0x5fcc3d14", "query_id": "<q>", "body_cell_hash": "0x…", "tx_hash": "<hash>" },
  "owner_before": "<operator>", "owner_after": "<recipient>",
  "offline_correlation": { "pp5_plan": "pp2/artifacts/pp5/pp5-plan.json", "body_matches_pinned": true },
  "verdict": "SETTLED"
}
```

## 6. Success criteria — PP#5-B PASSES iff

```
SC-1  the collection + item deploy land on ton-testnet (confirmed) and item #0 is owned by the operator
SC-2  OUR send_nft body (nftBodyToCell) is byte-identical to the §2-pinned BoC at the pre-broadcast gate
SC-3  after the send_nft tx, get_nft_data(item).owner_address == recipient (owner flipped), byte-exact
SC-4  the sandbox proof still reproduces (owner-flip + non-owner→401); determinism intact
SC-5  no Freeze Surface defect (send_nft is publication-layer; the consensus is read-only of it)
```

On all five, PP#5 is SETTLED → the `wallet.*` live-proof line (send_ton/send_jetton/send_nft) is complete.

## 7. Related
- `pp5-nft-proof.md` — the R0/R1 readiness + offline proof this gate broadcasts.
- `pp3-b-gate.md` / `pp4-b-gate.md` — the deploy/broadcast gate discipline this mirrors.
- `pp2/contracts/nft/` · `pp2/src/ir-to-boc.ts` · `pp2/artifacts/pp5/pp5-plan.json` — the pinned inputs.
