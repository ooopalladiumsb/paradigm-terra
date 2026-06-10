# PP#3-B Gate — pre-broadcast checkpoint (J1-C)

**Date:** 2026-06-10 · **Status:** gate / pre-registration. The checkpoint that must hold BEFORE the
irreversible ton-testnet broadcast (PP#3-B). Publication layer (§8.3) — no Freeze Surface. Follows
`pp3-b-gate` discipline: fix reproducibility, funding, the expected transition, and the roll-forward plan
in advance, so the broadcast is a confirmation, not a discovery.

## 1. Reproducibility evidence (pinned)

```
jetton source     ton-blockchain/token-contract/main/ft (official standard TEP-74), vendored verbatim
func-js           0.11.0 (pinned, exact)
minter codeHash   f95ba0330b38cdf3459b1e811e5fc6fa6cfee566d7b764455c0468140365a737
wallet codeHash   a760d629d5343e76d045017d9dc216fc8a307a8377815feb2b0a5c490e733486
commit            the PP#3-A merge + PP#3-A.2 head on post-release/j1-jetton-publication
CI                pp2 job reproduces the code hashes (test/pp3-jetton-build.test.ts)
```

## 2. Funding evidence (live, read-only, 2026-06-10)

```
operator          kQDKLzsxK0SFTZ9ucs0MLjikhpe0RvIPzjCYdE_BanfbgC3S  (the PP#2 W5R1 wallet)
  state           active
  balance         1 846 847 714 nano  (~1.847 TON)
  seqno           4
jetton master     kQCVJejKJIVA8b45PgMwv0va_YSClEaKP01GRtgXC8z8Tj_x  → state: uninitialized (fresh)
budget            ~0.5 TON of gas (deploy ~0.2 · mint ~0.2 · send_jetton 0.05 + fees) ≪ balance
```

## 3. Expected state transition — PROVEN OFFLINE (PP#3-A.2, @ton/sandbox)

Not a prediction: `test/pp3-sandbox.test.ts` runs the FULL path against the REAL compiled jetton in a
local TVM and asserts it. Our `send_jetton` body (`canonical_to_inner → jettonBodyToCell`) is executed by
the official jetton wallet:

```
mint:                 operator jetton balance  0 → 1000
send_jetton(250):     operator jetton balance  1000 → 750     (−250, exact)
                      recipient jetton balance 0    → 250      (+250, exact)   ⊆ holds: no widening
```

The testnet broadcast must reproduce exactly this (amounts in the test are the same as the run). A
divergence on testnet would be a network/gas issue, not a publication-logic defect (that is now proven).

## 4. Roll-forward plan (idempotency / resumability)

The PP#3-B script runs 4 on-chain steps; each checks current chain state before acting, so an interrupted
run resumes safely:

| Step | Irreversible? | Resume rule (idempotent guard) |
|---|---|---|
| A deploy minter | yes (once active) | skip if `jetton master` state == active |
| B mint to operator | yes | skip if operator jetton wallet balance ≥ SEND (already funded) |
| C send_jetton | yes (the proof tx) | guard: run once; if recipient jetton balance already ≥ SEND, treat as done |
| D observe + M2 correlate | no (read + idempotent upsert) | re-runnable; upsert keyed by external_message_hash |

Nothing before C affects the verdict; C is the single proof transaction. If C is broadcast but its effect
is unconfirmed, D inspects the chain (the PP#2 §3.1 "inspect before classifying" rule) — observed effect
decides, not the broadcast call.

## 5. Success criteria (PP#3 PASSES iff)

```
SC-1  send_jetton external accepted: tx_hash != null
SC-2  encoding fidelity: the published TEP-74 body == canonical_to_inner(cal) → ir_to_boc (our codec)
SC-3  effect fidelity (⊆): recipient jetton balance += 250 exactly; operator −= 250 exactly; no widening
SC-4  no Freeze Surface contradiction: freeze-gate byte-identical (it already is — consensus untouched)
SC-5  M2 reconciliation: the settlement is recorded + correlated in the M2 registry (status Settled)
```

Evidence package: `cal_hash · external_message_hash · jetton_master · operator_jetton_wallet ·
recipient_jetton_wallet · tx_hash · amount · recipient · operator/recipient jetton balances before+after ·
registry record_id · status=Settled · correlated=true`.

## 6. Authorization
PP#3-B is an irreversible multi-transaction broadcast on a public testnet. It runs ONLY on the operator's
explicit instruction ("broadcast PP#3-B"), with the broadcast step gated (BROADCAST=1) — the M2-C pattern.

## 7. Related
- `pp3-jetton-publication` (J1) — `j1-jetton-publication-charter.md`; `pfc2-jetton-reclassification.md`.
- `pp2/scripts/pp3-plan.mjs` / `pp2/artifacts/pp3/pp3-plan.json` — the DRY plan + resolved addresses.
- `pp2/test/pp3-sandbox.test.ts` — the §3 offline proof against the real jetton.
- `proof-package-2-spec.md` — the PP#2 verdict discipline PP#3 mirrors; `m2-charter.md` — the registry (SC-5).
