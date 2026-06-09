# PP#2-A.5 — Envelope Review (InnerRequest → SignedRequest → ExternalMessage)

**Date:** 2026-06-06 · Branch `post-freeze/pp2` · **No publication.** A design review between PP#2-A
(`ir_to_boc` round-trip, done) and PP#2-B (first testnet tx). Goal: fix the *sources and rules* for
every envelope field around our already-round-tripped inner body, so a contradiction is caught for
free rather than on a burned testnet run. DRAFT / publication-layer — §8.3 out-of-scope of the freeze.

## 1. The assembly chain & ownership

```
ExternalMessage (external-in to the wallet address)
  └─ body = SignedRequest:  opcode · wallet_id · valid_until · seqno · InnerRequest · signature(512)
                                                                         └─ ir_to_boc(canonical_to_inner(cal))   ← OURS (PP#2-A, round-tripped)
```

**Layered ownership (the key decision):**
- **Inner body** = ours. `canonical_to_inner → ir_to_boc` — validated offline (PP#2-A, `IR==IR'`).
- **Envelope** (opcode, `wallet_id` packing, `valid_until`/`seqno` placement, signature position) =
  **the fixed Wallet-V5R1 external standard**. We take it from the **reference builder**
  (`@ton/ton@16.3.0` `WalletContractV5R1`), exactly as PP#2-A took cell/BoC primitives from
  `@ton/core` — **we do not hand-transcribe the W5 bit layout.** Reinventing it would add risk with no
  benefit; the layout is not our model. What is *ours* and must be pinned is the **field values** we
  feed the builder, below.

## 2. Field sources & rules (what WE supply)

| Field | Source / rule | Maps to (§10.1 / §6.1) |
|---|---|---|
| `wallet_id` | the deployed W5R1 context (global_id=testnet, workchain 0, version r1, subwallet 0); computed by the reference builder, MUST equal the deployed wallet's | `agent_id` (the wallet address derived from `wallet_id`+pubkey) |
| `seqno` | **read live from the deployed wallet** (get-method `seqno`); see the §3 origin rule | `nonce` |
| `valid_until` | `unix_ts_at_tick(expiration_tick)` under **TON-valid ⊆ CAL-valid** (§4) | `expiration_tick` |
| signature | Ed25519 over the W5R1 signed-request hash, by the **operator key** | operator authorization |
| operator key ≟ wallet key | **MUST byte-match** the deployed wallet's `public_key` (§10.2) — satisfied *by construction*: we deploy the W5 with the harness operator pubkey | §10.2 invariant |
| `InnerRequest` | `ir_to_boc(canonical_to_inner(cal))` (OutList arm) | the action projection |

## 3. ⚠ Finding — nonce ↔ seqno origin mismatch (publication-layer)

§6.1 states `msg_seqno = cal.nonce`. But the origins differ:
- **CAL nonce is 1-based:** validator gate 3 is `expectedNonce = stored_nonce + 1`, `stored` starts 0,
  so the *first* action has `nonce = 1`.
- **W5 seqno is 0-based:** a freshly deployed wallet's `seqno = 0`; the first signed external MUST
  carry `seqno = 0`, and the contract increments afterwards.

So a literal `msg_seqno = cal.nonce` puts `seqno = 1` on the first action → **the wallet rejects it**
(expects 0). **Rule (publication-layer offset, freeze intact):**

```
seqno_supplied = wallet_current_seqno   (read live; authoritative)
assert  cal.nonce == wallet_current_seqno + 1      // 1-based CAL ↔ 0-based wallet, same +1 origin
```

i.e. the wallet's live `seqno` is the source of truth; the CAL nonce maps with the same `+1` origin
the validator already uses. This is a codec rule, **not** a Freeze Surface change (publication is
§8.3 out-of-scope). It is exactly the kind of seam this review exists to catch before a testnet run.

## 4. valid_until ↔ expiration_tick — the asymmetry to honor

The only model seam (already classified publication-layer). The verification target is directional:

- **Allowed:** a correct CAL becomes an *invalid* TON message (publication may shorten authorization).
- **Forbidden:** an *incorrect* CAL becomes a *valid* TON message (publication must never extend it).

```
TON-valid  ⊆  CAL-valid
```

**PP#2-B operational rule:** choose `expiration_tick` generously and set `valid_until = now + W`
(small wall-clock window, e.g. 60–120 s) such that the external expires *well before* the CAL's
logical expiry. Then the external can only ever be **stricter** than the CAL — the inclusion holds by
construction, and the live tx confirms the chain enforces `valid_until` as modeled. (The general
`unix_ts_at_tick` remains the open design item; PP#2-B does not need it resolved, only bounded.)

## 5. Replay protection / nonce mapping

One CAL = one external = one `seqno` increment. The W5 contract rejects a replayed/lower `seqno`,
mirroring the validator's nonce monotonicity (§6.2). So replay safety carries from off-chain to chain
through the §3 mapping — to be confirmed live in PP#2-B (submit, then re-submit the same external →
expect rejection).

## 6. What PP#2-B must answer (deferred to the live run)

1. The chain **accepts** the assembled external (`sendBoc` → `tx_hash != null`).
2. `seqno` / `valid_until` behave as modeled (§3, §4) on a real wallet.
3. **Effect fidelity** (PP#2-C): the on-chain action-phase effect == the CAL's authorized action
   (faithful dest + value, ⊆ holds in reality).
4. No Freeze Surface contradiction (criterion 7) — else the freeze re-opens.

## 7. Conclusion

The envelope assembly is well-defined at the design level: **inner = ours (proven); envelope = the
reference W5R1 builder; we supply `wallet_id`/`seqno`/`valid_until`/signature/operator-key by the
rules above.** One real seam was found and resolved offline — the **nonce↔seqno origin offset** (use
the wallet's live seqno; publication-layer, freeze intact). No further design-level contradiction.
Cleared to proceed to PP#2-B (first testnet `tx_hash`) when testnet funding is available.

## 8. Related
- `proof-package-2-spec.md` — PP#2 pre-registration (composition, success criteria, failure taxonomy).
- `pp2/README.md` + `pp2/src/ir-to-boc.ts` — PP#2-A inner-body codec (round-tripped).
- `cal-to-w5-mapping-review.md` — the CAL→W5 model review; the `valid_until` publication-layer ruling.
- `cal-validator-design.md` §10.1 (field map) / §10.2 (operator-key invariant); Exec-spec §6.1/§6.2.
