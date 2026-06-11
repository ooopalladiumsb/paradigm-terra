# PP#4 / PFC2-M8-R0 — Multisig Proof Package: readiness review (OFFLINE, no broadcast)

**Date:** 2026-06-11 · **Status:** readiness review / pre-registration. **NO testnet transaction; NO
broadcast.** The offline R0 gate for PP#4, mirroring the PP#2/PP#3 discipline (`pp3-b-gate.md`): fix what
PP#4 proves, the quorum CAL, the expected verdicts, reproducibility, and the design question — BEFORE any
code or irreversible broadcast, so the eventual broadcast is a confirmation, not a discovery.

## 0. What PP#4 proves (and what it does NOT)

Per `pfc2-m1-multisig-semantics.md` §6, PP#4 proves the **authorization envelope**, NOT an on-chain
multisig wallet. TON wallet contracts (W5) are single-key; PFC-2 changed CAL/validator/reducer/gas — the
*who-authorizes* layer — not the external wallet contract. So PP#4 must demonstrate, end-to-end:

```
quorum-authorized CAL   (≥ threshold distinct valid owner signatures)  → FINALIZED, publishes
sub-threshold CAL       (< threshold)                                  → QUORUM_NOT_MET, never publishes
```

with the on-chain effect of the finalized CAL carried by the **operator's existing W5 path** (PP#2-proven),
not a new contract. An on-chain multisig wallet contract is explicitly OUT (PFC-3 candidate, charter §4).

## 1. The design question R0 surfaces (decide BEFORE M8-R1) — KEY FINDING

The quorum gate fires for `OWNER_REQUIRED_ACTIONS` (or bounded mode). But the frozen taxonomy splits two
disjoint sets:

```
OWNER_REQUIRED_ACTIONS = {capability.update, agent.migrate, treasury.transfer, governance.vote_as_agent,
                          governance.propose_amendment, ptra.stake, ptra.unstake, failure_mode.emergency_withdraw}
                          — internal consensus actions; NONE publish a W5 external message.
W5-PUBLISHING verbs     = {wallet.send_ton, wallet.send_jetton} — NOT statically owner-required.
```

So a *statically* owner-required action has no W5 on-chain effect, and a W5-publishing verb is not
statically owner-gated. Two coherent framings for PP#4's on-chain leg:

| Framing | How the quorum gate ties to an on-chain effect | Verdict |
|---|---|---|
| **A. Bounded-mode `wallet.send_ton`** | §10.4: Bounded Mode escalates EVERY action to owner-required (`isOwnerRequired(action) \|\| boundedMode`). A bounded-mode `send_ton` is therefore quorum-gated AND publishes a real TON send via the operator W5 path (exactly PP#2's observable effect). | **RECOMMENDED** — a real, observable on-chain effect (a TON transfer) directly gated by the multisig quorum; reuses the PP#2-proven W5 send path; the sub-threshold variant visibly never broadcasts. |
| B. State-root anchor of a quorum-authorized `treasury.transfer` | The quorum-authorized internal action finalizes; its consensus STATE ROOT is anchored on testnet (the PFC-1 TON-mainnet-anchor pattern), not a W5 send. | defer — proves finalization but the on-chain artifact is an anchor hash, a weaker/indirect demonstration than a real gated transfer. |

**Recommended ruling (for explicit confirmation): Framing A — bounded-mode quorum-authorized `send_ton`.**
It makes the multisig authorization gate the *direct* cause of (or block on) a real testnet TON transfer,
which is the strongest faithful demonstration of "the envelope authorizes the on-chain effect."

> **⚠ SUPERSEDED by the M8-R1 grounding (2026-06-11): Framing A is NOT achievable on the frozen surface.**
> `BOUNDED_MODE_WHITELIST` (`dsl/src/taxonomy.ts`) = `{failure_mode.emergency_withdraw, failure_mode.exit_bounded,
> oracles.force_update, oracles.submit_feed, agent.freeze, cal.cancel}` — `wallet.send_ton` is **NOT** in it,
> and the §10.2 admission gate (`BOUNDED_BLOCKED`) runs *before* the owner/quorum gate. So a bounded-mode
> `send_ton` is rejected at §10.2 and never reaches the quorum gate — the §10.4 bridge fails (the very open
> item this §1 flagged). The owner-gateable and W5-publishing sets are therefore strictly disjoint with no
> bridge on the v0.1.0 surface; A would require adding a send verb to `OWNER_REQUIRED_ACTIONS` — a NEW Tier-C
> change, OUT of the M0 charter's "static M-of-N over the *existing* envelope" (§4). **Ruled (2026-06-11):
> PP#4 = Framing B**, the in-charter proof.

## 2. The quorum CAL structure (Framing B — RULED)

PP#4 gates a **`treasury.transfer`** (a statically owner-required action, no bounded mode needed). The
finalized CAL changes consensus state; its STATE_ROOT (`stateRootOf`, cal-reducer §7.3) is the on-chain
artifact, anchored on testnet (the PFC-1 anchor pattern), NOT a W5 send.

```
snapshot.registry.agents[A] = { operator_pubkey, owners: [K1,K2,K3] (sorted, distinct), threshold: 2,
                                granted_scopes: ["treasury_access:transfer"] }
CAL: action = treasury.transfer, steps=[transfer(amount)], signatures.owner_sigs = [env_K1, env_K2]
     (each a TC v2 Contract-A signData envelope over canonical_bytes(cal_without_signatures);
      ordered by matched pubkey; distinct)
trace.ownerSigners = [K1, K2]                      # node-verified, 2 of 3 ≥ threshold 2
→ validate() → FINALIZED → reducer applies → STATE_ROOT_after  (the anchor payload)

Sub-threshold twin: trace.ownerSigners = [K1] (1 < 2) → QUORUM_NOT_MET → no cal.validated → state UNCHANGED
                    → STATE_ROOT_after == STATE_ROOT_before (nothing to anchor).
```

`treasury.transfer` is owner-required in the FROZEN taxonomy, so no bounded mode / §10.2 whitelist / §7.1
emergency-invariant complications — the quorum gate is exercised directly on the chartered envelope.

## 3. Offline proof — ALREADY ACHIEVABLE (not a prediction)

The verdict half of PP#4 is **already proven** by the M5 golden vectors, reproduced byte-for-byte across
**TS == Rust == Go** (M6/M7, freeze-gate green):

```
ms_quorum_pass        2-of-3 → FINALIZED            (the quorum-authorized path finalizes)
ms_quorum_not_met     1-of-3 → QUORUM_NOT_MET       (the sub-threshold path is rejected, no cal.validated)
ms_migrated_1of1...   SC-4 byte-identity anchor
```

M8-R1 (offline) wires these into a realistic `treasury.transfer` CAL with REAL Contract-A owner envelopes
(multiple Ed25519 keys, signData over the canonical CAL bytes), runs it through validator→reducer, and
computes the consensus `STATE_ROOT` (`stateRootOf`) before/after: the quorum-pass transfer moves the root,
the sub-threshold twin leaves it unchanged. The moved root is the **anchor payload** for PP#4-B. **No
broadcast in R1** — the anchor commit to testnet is the gated live step.

## 4. Reproducibility evidence (to pin in M8-R1)

```
multisig surface   pfc2/consensus @ bac9716 (M2..M7 + re-freeze), all 6 CI checks green
golden vectors     validator/vectors/golden.json — NORMATIVE, TS==Rust==Go on all 30 (incl. 7 multisig)
W5 send path       orchestrator/src/w5/canonical-to-inner.ts (send_ton encoder, PP#2-proven)
sandbox harness    @ton/sandbox (pp2 module), pinned as in PP#3-A.2
```

## 5. Funding & broadcast — GATED, UNEXECUTED (explicit decision required)

Per the session constraint, **no testnet transaction and no funding query are performed in R0/R1.** The
live legs are deferred to an explicit PP#4-B decision:

```
PP#4-B (GATED — requires explicit go-ahead, a funded testnet operator, and key custody):
  1. read-only funding check of the anchoring operator wallet
  2. anchor the quorum-finalized STATE_ROOT on ton-testnet (a single external message carrying the root)
  3. confirm the sub-threshold twin produced no state change (STATE_ROOT unchanged → nothing anchored)
  4. record evidence (anchor tx hash, anchored root == the offline quorum-finalized root) → pp4b-evidence.json
```

This R0 doc and the M8-R1 offline proof do NOT touch the network. The broadcast is a separate, explicitly
authorized step — it is a *confirmation* of the offline-proven envelope, not a discovery.

## 6. The PP#4 path

```
M8-R0  Readiness review (this) ............... offline, no code, no broadcast  ← DONE
M8-R1  Offline proof scaffold ................ quorum treasury.transfer CAL + real owner envelopes +
                                               validator→reducer→STATE_ROOT (anchor payload); sub-threshold
                                               twin rejected (root unchanged). NO broadcast.
PP#4-B Broadcast ............................. GATED — explicit decision; the only live-network step.
PFC2   pfc2-consensus-freeze ruling .......... seals the re-frozen surface (the M1 §6 envelope, proven)
v2.0.0 Release ............................... pfc2/consensus merges to main (charter §7)
```

## 7. Related
- `pfc2-m1-multisig-semantics.md` §6 — the envelope-only framing PP#4 obeys.
- `pp3-b-gate.md` — the PP#3 pre-broadcast gate discipline PP#4-B will mirror.
- `pp2/test/pp3-sandbox.test.ts` — the offline @ton/sandbox TVM-validation pattern M8-R1 reuses.
- `proof-package-2-spec.md` — the PP#2 pre-registration discipline.
- `orchestrator/src/w5/canonical-to-inner.ts` — the send_ton W5 publication path (operator, unchanged).
