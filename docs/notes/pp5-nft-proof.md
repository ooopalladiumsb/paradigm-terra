# PP#5 / R0 — NFT Proof Package: readiness review (OFFLINE, no broadcast)

**Date:** 2026-06-12 · **Status:** readiness review / pre-registration. **NO testnet transaction; NO
broadcast.** The offline R0 gate for PP#5, mirroring the PP#3/PP#4 discipline (`pp4-multisig-proof.md`,
`pp3-b-gate.md`): fix what PP#5 proves, the `send_nft` CAL, the expected on-chain effect, reproducibility,
and the design point — BEFORE any harness or irreversible broadcast, so the eventual broadcast is a
confirmation, not a discovery. Publication layer (§8.3) — **no Freeze Surface** (released as v2.1.0).

## 0. What PP#5 proves (and what it does NOT)

PP#5 is the live end-to-end proof of the **`wallet.send_nft` publication path** (TEP-62), completing the
`wallet.*` live-proof line after PP#2 (`send_ton`) and PP#3 (`send_jetton`):

```
OUR send_nft body (canonical_to_inner → nftBodyToCell, op 0x5fcc3d14)
  → executed by an official-standard TEP-62 NFT item the operator owns
  → the item's owner changes  operator → recipient   (get_nft_data: owner_address == recipient)
  ⊆ holds: the new owner is faithful (no redirection); no second item moves; bounded TON only.
```

It does **NOT** prove: NFT mint/burn, collection deploy semantics, `custom_payload`/`forward_payload`
(all Non-goals, `send-nft-semantics.md`), nor anything in the consensus core (already finalized + frozen;
PP#5 is publication-layer only).

## 1. The design point R0 surfaces (decide BEFORE R1) — KEY DIFFERENCE FROM PP#3

Jetton (PP#3) and NFT (PP#5) settle differently, and R1 must respect it:

```
PP#3 jetton:  send to the operator's DERIVED jetton wallet (get_wallet_address); the operator's balance
              is debited. Setup = MINT N jettons to the operator.
PP#5 nft:     send DIRECTLY to the NFT ITEM contract (dest = nft_item; no derivation). The item checks
              msg.sender == current owner, then rewrites owner → new_owner. Setup = the operator must
              ALREADY BE THE CURRENT OWNER of the item.
```

So the **setup precondition is ownership, not balance**: PP#5 must first put an item into the operator's
ownership (mint one item from a standard collection to the operator), then drive `send_nft`. This is the
NFT analog of PP#3's "mint 1000 to operator" — but the asset is indivisible and the authorization is
"current owner," exercised by the operator's existing W5 path (PP#2-proven, unchanged).

There is **no amount** to verify (an NFT item is whole); the observable is the **owner field flipping**,
not a numeric delta. The ⊆ rule therefore binds the *new owner* and the *item identity*, not a quantity.

## 2. The send_nft CAL structure + on-chain effect

```
snapshot.registry.agents[A] = { operator_pubkey, granted_scopes: ["nft_access"], … }
CAL: action = wallet.send_nft,
     steps = [ send_nft(nft_item = ITEM, new_owner = RECIPIENT, query_id = Q) ]
→ validate() → FINALIZED → canonical_to_inner → ONE action_send_msg:
     dest    = ITEM                         (the item contract, resolved directly)
     value   = forward_amount + 0.05 TON    (bounded gas; exact-value mode; bounces)
     body    = TEP-62 transfer (op 0x5fcc3d14): query_id, new_owner=RECIPIENT,
               response_destination=operator, custom_payload absent, forward_amount, forward_payload absent
→ operator W5 external publishes it → ITEM rewrites owner → RECIPIENT.

Observable: ITEM.get_nft_data().owner_address  ==  RECIPIENT  (was operator).
```

`wallet.send_nft` carries `nft_access` and finalizes through the generic validator/reducer/gas (frozen);
PP#5 exercises only the §8.3 publication leg, which v2.1.0 added.

## 3. Offline proof — ACHIEVABLE in R1 (sandbox, mirrors PP#3-A.2)

R1 (offline, future) runs the FULL path against the REAL compiled standard NFT in `@ton/sandbox`, exactly
as `pp2/test/pp3-sandbox.test.ts` does for jetton — not a prediction:

```
1. vendor the official standard TEP-62 NFT verbatim (ton-blockchain/token-contract / nft:
   nft-collection.fc + nft-item.fc), compile with the pinned func-js (0.11.0), record code hashes.
2. deploy collection → mint ITEM #0 to the operator (operator is the current owner).
3. build OUR send_nft body via nftBodyToCell({ new_owner: recipient, query_id, … }) — EXACTLY what
   canonical_to_inner emits (reconstructed in pp2 so its CI stays orchestrator-independent).
4. operator W5 sends value+body to ITEM; assert get_nft_data().owner_address flips operator → recipient.
5. deterministic vectors: the serialized transfer body BoC + cell hash pinned (as in pp4-anchor-body),
   so PP#5-B re-asserts byte-identity before broadcast.
```

A mismatch (wrong owner, item rejects our body, ⊆ violated) is a publication-layer defect found with **no
network**.

## 4. Reproducibility evidence (to pin in R1)

```
send_nft codec    v2.1.0 — encodeSendNft (op 0x5fcc3d14) + nftBodyToCell; tests send-nft-codec (12) /
                  send-nft-boc (6); orchestrator 128/128, pp2 29/29, freeze-gate byte-identical
nft source        ton-blockchain/token-contract (nft) — official standard TEP-62, vendored verbatim
func-js           0.11.0 (pinned, exact — same as PP#3)
sandbox harness   @ton/sandbox (pp2 module), pinned as in PP#3-A.2
W5 send path      orchestrator/src/w5/canonical-to-inner.ts (operator W5, PP#2-proven, unchanged)
```

## 5. Funding & broadcast — GATED, UNEXECUTED (explicit decision required)

Per the standing discipline, **no testnet transaction and no funding query are performed in R0/R1.** The
live legs are deferred to an explicit PP#5-B decision (mirrors PP#3-B / PP#4-B):

```
PP#5-B (GATED — requires explicit go-ahead, a funded testnet operator, and key custody):
  1. read-only funding check of the operator wallet (budget: deploy collection ~0.2 · mint ~0.1 ·
     send_nft 0.05 + fees ≈ ~0.4 TON)
  2. deploy the standard collection + mint ITEM to the operator on ton-testnet
  3. PRE-BROADCAST GATE: re-assert the send_nft transfer-body BoC == the R1-pinned bytes
  4. broadcast OUR send_nft from the operator W5 → ITEM
  5. observe: get_nft_data(ITEM).owner_address == recipient (owner flipped) — "inspect before classifying"
  6. record evidence (tx hash, owner before/after) → pp2/artifacts/pp5/pp5b-evidence.json
```

R0 (this) and R1 do NOT touch the network. The broadcast is a separate, explicitly authorized step — a
*confirmation* of the offline-proven path, not a discovery.

## 6. The PP#5 path

```
R0     Readiness review .................. offline, no code, no broadcast  ← DONE
R1     Offline proof scaffold ............ DONE — vendored standard TEP-62 NFT (pp2/contracts/nft/, code
                                          hashes pinned in nft-compiled.json, PP#5-A build test); @ton/sandbox
                                          proof (pp5-sandbox.test.ts): deploy collection + mint item #0 to
                                          operator + OUR send_nft → owner flips operator→recipient; a
                                          non-owner attempt aborts exit 401 (ownership unchanged). Reference
                                          body pinned in pp2/artifacts/pp5/pp5-plan.json (cell hash
                                          0xc19cb8f2…). pp2 suite 32/32. NO broadcast.
PP#5-B Broadcast .......................... GATED — explicit decision + funded operator; the only live step.
(no freeze ruling — publication layer; PP#5 confirms v2.1.0's send_nft live, no version bump required
 unless batched into a later release note.)
```

### R1 evidence (offline, pinned)

```
nft standard       ton-blockchain/token-contract/main/nft (TEP-62), vendored verbatim; func-js 0.11.0
collection codeHash 8e5aab17e2e503bec75c2f453b9dacf11a98bbb2cc202994710952a7271c7780
item codeHash       ba4d975d2b66231c1f0a0ccca6e8ff8f7ba0610c4b7639584b8e98303dc3128c
sandbox proof       pp2/test/pp5-sandbox.test.ts — owner flips operator→recipient; non-owner → exit 401
reference body      pp2/artifacts/pp5/pp5-plan.json — cell hash 0xc19cb8f2c5c61336681fb65a79b052f7b02272686e9fd5e3d834c9ca7bd8f625
```

## 7. Related
- `send-nft-semantics.md` — the TEP-62 mapping + Non-goals PP#5 obeys.
- `pp4-multisig-proof.md` — the R0/R1/-B discipline this mirrors.
- `pp3-b-gate.md` · `pp2/test/pp3-sandbox.test.ts` — the deploy→mint→OUR-body→assert sandbox pattern R1 reuses.
- `orchestrator/src/w5/canonical-to-inner.ts` · `pp2/src/ir-to-boc.ts` — the send_nft codec under proof.
