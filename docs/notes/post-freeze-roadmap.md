# Post-Freeze roadmap & branch discipline

**Date:** 2026-06-06 · **Updated:** 2026-06-12 (under **v2.0.0**). Originally written after the PFC-1
Consensus Freeze; now covers two frozen lines (PFC-1 + PFC-2) and three releases (v1.0.0, v1.1.0, v2.0.0).

## The risk has evolved (the ladder so far)

```
Before OVT / Freeze:   "Is the model correct?"              → answered (no Freeze Surface defect in OVT)
PFC-1 + PP#2:          "Does real TON match the model?"     → answered (send_ton live, tx 8d4b96e6…)
PR-1:                  "Can we operate it for years?"       → answered (daemon + recovery + observability)
Track A → v1.0/1.1:    "Can we declare a version released?" → answered (governed, auditable cuts)
PFC-2 → v2.0.0:        "Can the authorization model move    → answered (M-of-N quorum; PP#4-B anchored,
                        and re-freeze cleanly?"               tx 7aaabb93…, root 0x4a14…d4f0)
        ↓
Next dominant question: "Can the surrounding economy + a real validator set be built on the frozen
                         consensus — without re-opening it?"
```

Each rung retired a question about the *system*. The remaining work is mostly **breadth on top of a frozen
core**, plus one deep architectural item (a distributed validator set). None of it requires re-opening
PFC-1 or PFC-2; consensus-touching items start their **own** freeze line.

## Freeze lines & branch discipline

Two frozen reference objects now exist:

```
pfc1-consensus-freeze  @ 54e1864  (frozen state 2fd4b8a)  → v1.0.0 / v1.1.0  (send_ton, send_jetton)
pfc2-consensus-freeze  @ 56ba188                          → v2.0.0           (Multisig v2.1, M-of-N quorum)
```

The rule that decides where work lands is unchanged:

- **Above the Freeze Surface** (operations, publication codecs, docs, tooling) → the current release line,
  MINOR/PATCH, ordinary PR up the `L1 → L2 → L3` stack. The `freeze-gate` stays byte-identical.
- **Touches the Freeze Surface** (model / consensus / economics / validator / canonicalization) → a **new
  line of work** on its own branch, and if it changes consensus, its **own freeze line** (`pfc3-…`) → MAJOR.
- **Discovery of a Freeze Surface defect** re-opens the relevant freeze rather than being patched silently
  (criterion 7 is permanent, on both PFC-1 and PFC-2).

## Done (closed since the original PFC-1 roadmap)

```
PP#2 — Testnet Validation       ✅ 2026-06-06  (send_ton live, tx 8d4b96e6…, effect faithful)
H3.5 — Live external observer    ✅ PR-1.8      (tails a running node's root in real time)
Production Readiness (PR-1)       ✅ 2026-06-08  (daemon, snapshot+tail recovery, metrics→alerting, backup)
Launch Readiness (Track A)        ✅ 2026-06-09  (release governance + gate → v1.0.0)
v1.x maintenance (M1–M3,A1,A2)    ✅ 2026-06-10  (CI hardening, registry reconciliation, durability, soak, observers)
J1 — wallet.send_jetton           ✅ v1.1.0      (PP#3 SETTLED on ton-testnet, recipient 0→250)
PFC-2 — Multisig v2.1             ✅ v2.0.0       (PP#4-B SETTLED, anchor tx 7aaabb93…; pfc2-consensus-freeze)
wallet.send_nft (TEP-62)          ✅ v2.1.0       (PP#5-B SETTLED, NFT owner operator→recipient, tx 687c7d70…)
Layer 2 — on-chain read-models    ✅ v2.2.0       (Registry/Treasury/FailureState/Capability/Anchor + genesis; Genesis-B live)
Layer 3 Stage-A — gov/oracle/PTRA ✅ v2.3.0       (governance/oracle/ptra read-models; genesis → 8 contracts; Framing-A/Tier-M)
```

The `wallet.*` live-proof line is COMPLETE (send_ton/send_jetton/send_nft, all SETTLED on ton-testnet) and
the on-chain observational suite (8 read-models) is built + genesis-deployable. The v2.x operational
contour is closed. **The next major track is PFC-3 (Framing B — the on-chain decision economy).**

## Forward roadmap (under v2.3.0)

Layered by dependency; line tag = where it lands (🟢 Tier-M MINOR · 🔴 new PFC freeze/MAJOR · ⚪ off-consensus).
Effort: S ≤1wk · M 2–4wk · L 1–2mo · XL 3–6mo · XXL 6mo+.

```
Layer 1 — verb-publication completeness                                    ✅ DONE
  wallet.send_ton/jetton/nft all live (PP#2/PP#3/PP#5-B SETTLED)

Layer 2 — on-chain read-models + genesis (Tolk via @ton/tolk-js)          ✅ DONE (v2.2.0; Genesis-B live)

Layer 3 Stage-A — gov/oracle/PTRA read-models                             ✅ DONE (v2.3.0; Framing A, Tier-M)

PFC-3 (Layer 3 Framing B) — the on-chain DECISION economy                 🔴 NEXT — Tier-C → MAJOR v3.0.0
  PFC-3A Governance Authority : NFT-slot voting + quadratic tally + timelock execution
  PFC-3B Oracle Authority     : on-chain feed aggregation + slashing
  PFC-3C PTRA Economics       : real PTRA token + on-chain staking/reward emission
  (each its own freeze sub-line; full PFC discipline — charter, golden vectors, parity, re-freeze, live proof)

Layer 4 — distributed consensus + product
  Distributed validator set / real consensus    XXL  🔴  ← hidden critical path; start early, in parallel
  full sendTransaction + on-chain Registry channel · Agentic Wallet SBT · agent runtime · dashboard

Off-consensus / parked (NOT on the critical path)
  Telegram Mini App (tma-charter.md)            M   ⚪  branch product/tma, draft PR #30
  Confidential compute (Cocoon) · multilingual layer · EXPIRED_POST/AGENT_BUSY staged validator
```

**Next major track = PFC-3** (the reserved on-chain governance/oracle/PTRA *economy* — qualitatively
"decides/settles/governs/slashes/mints/stakes", vs Stage-A's "reflects/never decides"). Split into
PFC-3A/B/C so the track isn't monolithic. The distributed validator set (Layer 4, XXL) remains the
near-parallel, easily-underestimated second path. **Highest hidden
risk:** distributed consensus — the spec assumes ≥3 validators (CONSENSUS_UNCERTAINTY exit), today it is a
single node + observers.

## Related
- `pfc2-consensus-freeze-draft.md` / `freeze-manifest-pfc1.md` — the two freeze rulings + normative inventories.
- `release-notes-v2.0.0.md` · `release-governance.md` — the v2.0.0 cut + the version-axis rule.
- `roadmap-v1.x.md` — the (now-complete) Tier-M maintenance line above PFC-1.
- `tma-charter.md` — the parked off-consensus Telegram Mini App track.
- `pp4-b-gate.md` · `pp2/artifacts/pp4/pp4b-evidence.json` — the PP#4-B anchor proof + evidence.
