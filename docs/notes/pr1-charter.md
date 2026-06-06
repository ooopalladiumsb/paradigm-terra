# PR-1 — Production Readiness charter

**Date:** 2026-06-06 · Branch `post-freeze/pr1` · Opens the operational track after PFC-1 Consensus
Freeze + PP#2 (confirmed on testnet) + H3.5 (independent reproduction). **This is operational
engineering, not model validation.** Like the OVT charter and the PP#2 pre-registration, it fixes the
discipline, the Definition of Done, and the one metric that matters — before the build.

## The transition this track marks

```
"Can this consensus model work?"            → ANSWERED (OVT + PP#2 + H3.5)
        ↓
"Can a third party verify it works?"        → ANSWERED (H3.5 independent reproduction)
        ↓
"Can we operate it for years?"              → PR-1 (this track)
```

The five proof levels PR-1 rests on (do **not** re-prove): (1) math/state-machine — TS↔Go parity,
deterministic replay, crash recovery, WAL durability, economic + griefing invariants; (2) long-run —
soak streams, zero root drift, state-growth measured; (3) publication layer — CAL→InnerRequest→BOC,
envelope, nonce↔seqno, valid_until, encoding fidelity; (4) real network — sendBoc → tx_hash →
finalized → effect == CAL; (5) independent reproduction — an observer re-derives the verdicts from
repo + chain with no author involvement.

## Discipline (anti-scope)

- PR-1 builds operational layers **strictly above the Freeze Surface**. It touches no
  canonical/dsl/cal/validator/reducer/gas normative code. (A Freeze-Surface defect surfaced *during*
  PR-1 still re-opens the freeze — OVT criterion 7 is permanent — but that is not PR-1's goal.)
- **No new verb classes** (jetton, nft, bounded-mode, …) on this track. Until the daemon layer exists,
  new verbs grow the system's surface faster than its operational maturity. `wallet.send_ton` is the
  proven path; coverage expansion is a *later* track, after operational maturity.
- Reuses the proven `OvtNode` (OVT-2 persistent node: WAL + deterministic re-fold) as the kernel the
  daemon wraps; the daemon adds lifecycle, not new consensus.

## The metric that matters: Cold Recovery Time

Not TPS, not gas, not verb count. The single **known** operational bound (OVT-SG, measured):

```
1,000,000 CALs  ≈  ~2 h cold re-fold      (linear; STATE_ROOT recomputed per event ⇒ ~1.5–2 ms/event)
```

A rare, clean situation: **problem measured ✓ · cause known ✓ · solution known ✓ · deliberately
deferred ✓.** The solution is checkpointing: `recover = load latest snapshot + replay the tail`,
turning ~2 h into seconds. PR-1.2 closes it; PR-1.3 pins a recovery SLA. (Not a Freeze-Surface defect —
the root *values* are correct; this is operational cost.)

## Stages

| Stage | Goal | Closes |
|---|---|---|
| **PR-1.1** | **Long-running daemon** — clock-driven ticks, mempool, async submission intake, lifecycle over `OvtNode` | the structural enabler for 1.2 / 1.3 / 1.8 |
| PR-1.2 | Snapshot / checkpoint — periodic state snapshot; `recover = snapshot + tail replay` | OVT-SG / the Cold-Recovery bound |
| PR-1.3 | Fast-recovery SLA — recovery stays practical at 1M+ CALs (target, e.g. < 60 s) | OVT-SG DoD criterion 6 |
| PR-1.4 | Metrics — tick rate, mempool depth, recovery time, state size, event-log growth |  |
| PR-1.5 | Monitoring — health/liveness, drift watch (TS vs Go on the live stream) | H3.3 continuous |
| PR-1.6 | Alerting — on drift, stall, recovery-SLA breach, state-growth thresholds |  |
| PR-1.7 | Backup / restore — snapshot + WAL backup, verified restore round-trip |  |
| PR-1.8 | Live-observer daemon — third party tails a running node's root in real time | **H3.5-live** |
| PR-1.9 | 7–30 day soak — continuous operation, zero root drift, zero Freeze-Surface defect | the readiness gate |

**Leverage:** PR-1.1 (daemon) is the one structural piece that unlocks the three deferred tails at
once — **daemon → checkpointing (1.2) → H3.5-live (1.8)** — so it is the highest-ROI first step.

## Definition of done (PR-1 complete when all hold)

1. The node runs as a continuous **process** (clock ticks + mempool + async intake), not a batch fold.
2. `recover = snapshot + tail replay` meets the PR-1.3 recovery SLA at ≥ 1M CALs.
3. Metrics + monitoring + alerting cover drift, stall, recovery-SLA, state-growth.
4. Backup → restore round-trips to an identical STATE_ROOT.
5. A third party tails a live node's root independently (H3.5-live).
6. A 7–30 day soak runs with **zero** root drift and **zero** Freeze-Surface defect.

## Roadmap position

```
PFC-1 Consensus Freeze  ✅
  → PP#2 Confirmed       ✅ (ton-testnet)
  → H3.5 Independent Reproduction  ✅ (offline/on-chain-read; live half is PR-1.8)
  → PR-1 Operational Platform      ◀ this track
  → Launch Readiness
```

## Related
- `operational-validation-track.md` — OVT (the kernel + OVT-SG measurement PR-1.2 closes).
- `post-freeze-roadmap.md` — Production Readiness was Tier-3 there; this charter expands it.
- `proof-package-2-spec.md` / `reproducibility-guide.md` — PP#2 + H3.5 (the levels PR-1 rests on).
- `orchestrator/src/node/persistent-node.ts` — `OvtNode`, the kernel the daemon wraps.
