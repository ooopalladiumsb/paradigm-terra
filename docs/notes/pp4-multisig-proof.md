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

## 2. The quorum CAL structure (Framing A, to be finalized in M8-R1)

```
snapshot.registry.agents[A] = { operator_pubkey, owners: [K1,K2,K3] (sorted), threshold: 2, granted_scopes }
state.failure_mode.is_bounded_mode = true        # §10.4 escalation → send_ton becomes owner-required
CAL: action = wallet.send_ton, steps=[send_ton(to, amount)], signatures.owner_sigs = [env_K1, env_K2]
     (each a TC v2 Contract-A signData envelope; ordered by matched pubkey; distinct)
trace.ownerSigners = [K1, K2]                      # node-verified, 2 of 3 ≥ threshold 2
→ validate() → FINALIZED → W5 publication (operator path) → testnet send

Sub-threshold twin: trace.ownerSigners = [K1] (1 < 2) → QUORUM_NOT_MET → no cal.validated → never published.
```

Bounded mode also appends the §7.1/§10.3 emergency invariant set and applies the §10.2 whitelist — M8-R1
must confirm `wallet.send_ton` is bounded-allowed (or pick a whitelisted send), and that the emergency
invariants hold over the trace. (Open item for R1; not a blocker for the envelope proof.)

## 3. Offline proof — ALREADY ACHIEVABLE (not a prediction)

The verdict half of PP#4 is **already proven** by the M5 golden vectors, reproduced byte-for-byte across
**TS == Rust == Go** (M6/M7, freeze-gate green):

```
ms_quorum_pass        2-of-3 → FINALIZED            (the quorum-authorized path finalizes)
ms_quorum_not_met     1-of-3 → QUORUM_NOT_MET       (the sub-threshold path is rejected, no cal.validated)
ms_migrated_1of1...   SC-4 byte-identity anchor
```

M8-R1 (offline) wires these into a realistic bounded-mode `send_ton` CAL with REAL Contract-A owner
envelopes (multiple keys), runs it through the validator→reducer→W5-publication, and validates the W5
external message in a local TVM via `@ton/sandbox` (the PP#3-A.2 pattern, `pp2/test/pp3-sandbox.test.ts`):
the operator's W5 wallet executes the published send EXACTLY as PP#2 — confirming the on-chain effect is
the unchanged operator path. **No broadcast in R1.**

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
  1. read-only funding check of the operator wallet (the PP#2 W5R1 wallet, or a fresh one)
  2. broadcast the quorum-authorized bounded-mode send_ton; observe the TON transfer on testnet
  3. attempt the sub-threshold twin; confirm the node never publishes it (QUORUM_NOT_MET pre-broadcast)
  4. record evidence (tx hash, on-chain effect == authorized action) → pp4b-evidence.json
```

This R0 doc and the M8-R1 offline proof do NOT touch the network. The broadcast is a separate, explicitly
authorized step — it is a *confirmation* of the offline-proven envelope, not a discovery.

## 6. The PP#4 path

```
M8-R0  Readiness review (this) ............... offline, no code, no broadcast  ← DONE
M8-R1  Offline proof scaffold ................ bounded-mode quorum send_ton CAL + real owner envelopes +
                                               validator→reducer→W5 publication + @ton/sandbox TVM check;
                                               sub-threshold twin rejected. NO broadcast.
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
