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

### PR-1.1a — DONE (2026-06-07): daemon skeleton + first operational profile

`orchestrator/src/node/pr1-daemon.ts` (`Pr1Daemon`) wraps `OvtNode` with the lifecycle
`BOOTING→RECOVERING→CATCHING_UP→RUNNING→SHUTTING_DOWN`, a wall-clock tick driver, an async mempool
(drains ≤1 submission per agent per tick, respecting §6.1 single-in-flight), and `submit/status/
metrics/shutdown`. No network/RPC/monitoring. Demo `scripts/pr1-daemon-demo.mjs` (4 agents × 12
rounds); tests `test/pr1-daemon.test.ts` (lifecycle + finalize + recovery), suite 27/27.

**First operational profile (4×12, tick 200 ms):** 48/48 FINALIZED; post-shutdown re-fold == live
STATE_ROOT (OVT-2 durability holds for the process); shutdown latency ~0 ms; cold recovery 18 ms
(empty WAL). **The measured finding — the wall PR-1.2 must remove:** per-tick latency climbed to
**~465 / 812 ms avg/max against a 200 ms interval** because `OvtNode.submit()` re-folds the whole WAL
from genesis each tick (O(n)/tick). Once per-tick work exceeds the interval (~tick 40), the synchronous
handler blocks the event loop and tick drift blows out to **~11 s**. So the daemon is a real process,
but steady-state runtime is O(n²) cumulatively — confirming that PR-1.2 needs **maintained live state
(incremental O(1) apply)** for runtime, *in addition to* snapshot+tail-replay for cold recovery. This
is exactly "observe the new layer before optimizing": the optimization target is now measured, not
forecast. Re-run: `cd orchestrator && node --import tsx scripts/pr1-daemon-demo.mjs`.

### PR-1.1b — DONE (2026-06-07): crash / restart against the final recovery pipeline

The daemon now closes the loop `RUNNING → crash → start() → restore(snapshot) → replay_tail → RUNNING`.
The tick loop snapshots on the PR-1.3 cadence (`maybeSnapshot`); graceful shutdown snapshots (empty-tail
restart); `OvtNode.open()` exposes `recoveryMode` (FRESH / FULL_REPLAY / SNAPSHOT_TAIL) + `recoveredTailTicks`,
and gained an `ignoreSnapshots` audit path (full-replay, complete transcript). `Pr1Daemon.simulateCrash()`
abandons the process without flush/snapshot (fault injection). Tests (`test/pr1-daemon-restart.test.ts`)
— **Gate 1** crashed+recovered == uninterrupted (STATE_ROOT + GLOBAL_ROOT, the latter binding eventCount
+ lastEventHash); **Gate 2** the restart used SNAPSHOT_TAIL (not a silent full re-fold); **Gate 3** the
recovered tail ≤ cadence and modelled recovery ≤ SLA (model-based, CI-stable) — plus the worst case
(crash at the cadence boundary ⇒ maximal tail N−1, still byte-exact). Suite 60/60. The restart criterion
is now **restart ∧ recovery ≤ SLA**, not merely "the process came up."

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
