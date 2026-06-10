# Roadmap v1.x — post-release (after v1.0.0)

**Date:** 2026-06-09 · Follows the inaugural release `v1.0.0` (`release-signoff-v1.0.0.md`,
`release-notes-v1.0.0.md`), riding `pfc1-consensus-freeze`. The project has moved from *preparing a
release* to *maintaining a released line*. This document is the post-release backlog and, more
importantly, the **rule for where each item is allowed to land**.

> **STATUS: v1.x MAINTENANCE PROGRAM = COMPLETE (2026-06-10).** All Tier-M items closed — M1 CI hardening ·
> M2 Registry reconciliation · M3 durability · A1 long-duration soak · A2 distributed observers — every one
> merged with the Freeze Surface byte-identical (orchestrator suite 113/113). Further changes are bug/security
> fixes, operational incidents, or **Tier C → PFC-2 → v2.0.0**. **J1 — `wallet.send_jetton` publication
> path: ✅ CLOSED → released as v1.1.0 (2026-06-10)** (`release-notes-v1.1.0.md`): J1-A codec · J1-B
> `ir_to_boc` · J1-C **PP#3 SETTLED live on ton-testnet** (recipient `0→250`, ⊆ exact, M2-correlated).
> jetton was found to already finalize through the frozen consensus, so it shipped as a publication
> feature, freeze-gate byte-identical (`pfc2-jetton-reclassification.md`). A *genuine* PFC-2 is reserved
> for **Multisig v2.1** (moves the authorization model).

## The one rule this roadmap encodes

Per `release-governance.md`, the freeze line decides the version axis:

```
Above the Freeze Surface  →  the 1.x line  →  MINOR / PATCH on pfc1-consensus-freeze
Touches the Freeze Surface →  a NEW freeze line (PFC-2) → MAJOR 2.0.0, its own branch + freeze
```

So this roadmap has exactly two tiers, and an item's tier is **not** a matter of taste — it is decided
mechanically by whether the `freeze-gate` job would change (`vectors-check` + `verify-proof-ts` +
`verify-proof-go`). Everything in Tier M ships without a new freeze decision; everything in Tier C
**cannot** ship on the 1.x line at all.

Already closed by PR-1 — **do not reopen as roadmap items**: H3.5-live (live observer, PR-1.8), OVT-SG
state checkpointing / cold-recovery (PR-1.2/1.3), metrics/monitoring/alerting (PR-1.4–1.6), backup→
restore round-trip (PR-1.7), the readiness soak gate (PR-1.9). PP#2 (testnet `send_ton`) is confirmed.

## Tier M — Maintenance & operations (the 1.x line, above the Freeze Surface)

MINOR (new operational capability) or PATCH (tooling/docs/fixes). None of these may alter a normative
artifact; each ships as an ordinary operational PR up the `L1 → L2 → L3 → Track A` stack.

| Item | What | Bump | Notes |
|---|---|---|---|
| **Registry deployment** ✅ **M2, CLOSED** | M2 = Registry **reconciliation** contract (settlement observation) for the proven `send_ton` path — see `m2-charter.md` | MINOR | DONE (PRs #6–#9): `m2-registry/` Tolk contract, SC-1 reproducible build + SC-2 four-class reconciler + **SC-3 verified live on ton-testnet** (registry `kQA2oxgA…`, real `send_ton` recorded). Non-normative, offline-first, network leg gated. SC-4/SC-5 held. |
| **`rust-parity` runner stabilization** ✅ **M1, CLOSED** | provision the CI runner for the repo's musl-static / `rust-lld` build so the optional `rust-parity` job goes green, then **promote it to required** | PATCH→policy | DONE (`post-release/m1-rust-ci-runner`, PR #5): `targets: x86_64-unknown-linux-musl` on the toolchain step reproduced the freeze build model on the runner (all 4 jobs green); `rust-parity` promoted optional → required. Full TS == Rust == Go gate now enforced on 1.x. |
| **Remote / incremental backups** ✅ **M3, CLOSED** | extend PR-1.7 local backup→restore to off-host and incremental (snapshot + WAL deltas) — see `m3-charter.md` | MINOR | DONE (PRs #10–#13): M3-A incremental (`backup-incremental.ts`, `restoreChain == node@t`) + M3-C remote sink (`backup-sink.ts`, round-trip == node@t, real cloud gated). Suite 103/103, SC-4/SC-5 held. |
| **WAL archival / compaction** ✅ **M3, CLOSED** | bound on-disk growth: archive/compact the event log behind snapshots without breaking byte-exact replay — see `m3-charter.md` | MINOR | DONE (M3-B, PR #12): `wal-compaction.ts` — rebase snapshot + archive prefix; `replay-from-compacted == replay-from-full`, graceful corrupt-snapshot fallback. |
| **Distributed observers** ✅ **A2, CLOSED** | scale PR-1.8's single live observer to multiple independent tailers (consensus on the published root) — see `a2-distributed-observers-charter.md` | MINOR | DONE (PRs #16–#17): `observer-fleet.ts` — `ObserverFleet` quorum verdict distinguishes NODE_DRIFT (quorum unanimously contradicts the node) from OBSERVER_SPLIT (a faulty tailer isolated, node corroborated). Observe-only, 6/6. **Last Tier-M operational item.** |
| **Long-duration soak program** ✅ **A1 code CLOSED** (wall-clock run operational) | run the 7–30 day continuous soak the PR-1 charter named (PR-1.9 proved the gate over 120 ticks) — see `a1-soak-charter.md` | PATCH/process | DONE (PRs #14–#15): `soak-program.ts` extends PR-1.9 `SoakMonitor` to SC-1/4/6 (restore-equivalence + fd/disk + duration); accelerated proof 4/4 + runbook. The literal 7/30-day run is OPERATED on infra; the code gate is the accelerated test + SC-Freeze. |
| **`path_segment` gas — advisory** | the one §C.3 weight out of band in all three tree-walkers (Gate #2 baseline) — *measure only* on the 1.x line | PATCH | the unit **counts** are consensus-locked anti-grief weights (§C.4); a re-weight is **not** a 1.x change — it is Tier C. |

## Tier C — Consensus expansion (a NEW freeze line: PFC-2 → 2.0.0)

Anything here touches the Freeze Surface and therefore **cannot** ride the 1.x line. Each requires the
full freeze-adjacent process (`release-governance.md §Freeze-Adjacent Changes`): a separate review, a
dedicated freeze branch, regenerated evidence (vectors re-promoted to NORMATIVE, Proof Package
re-verified in TS *and* Go), and an explicit new freeze decision (`pfc2-consensus-freeze`). The release
that carries it is `2.0.0`.

- **New verb classes** — ~~jetton, nft~~, bounded-mode beyond the frozen set, etc. ⚠ **CORRECTION
  (2026-06-10):** `jetton`/`nft` are **already registered** in the frozen §2.3 taxonomy with frozen scopes
  (`jetton_access`/`nft_access`) and generic validator/reducer/gas — `wallet.send_jetton` **finalizes
  through the frozen consensus today** (`pfc2-jetton-reclassification.md`). They are **Tier M publication
  features**, not Tier C: shipped by the **J1 track** (`j1-jetton-publication-charter.md`, v1.1.0). Only a
  verb whose semantics are NOT already frozen, or bounded-mode expansion, would be Tier C here.
- **Multi-owner (Multisig v2.1) flows** — a new ownership/authorization model ⇒ consensus. **← the
  reserved first verb for a genuine PFC-2** (it actually moves the authorization Freeze Surface).
- **Agentic Wallet SBT — TEP** — the on-chain identity standard; a normative external contract surface.
- **Tolk normative on-chain artifacts** — promoting on-chain contracts to normative status.
- **Any gas-weight change** (incl. the `path_segment` re-weight, if ever pursued) — the unit counts are
  consensus-locked (§C.4), so a change is a new economic model ⇒ PFC-2.

## Posture

`v1.0.0` ships the **proven** path (`wallet.send_ton`, confirmed live). The 1.x line hardens operations
and integration **around** that frozen core; it does not grow the core. Growing the core is a
deliberate, governed PFC-2 event — not an incremental feature. Until then, the discriminator on every
proposed change is the same one CI uses: *would `freeze-gate` move?* If yes, it's PFC-2.

## Related
- `release-governance.md` — the versioning / freeze-line / freeze-adjacent policy this roadmap obeys.
- `release-gate.md` — CI gate + findings (incl. the `rust-parity` environmental RED).
- `post-freeze-roadmap.md` — the original branch/freeze discipline (pre-release).
- `freeze-manifest-pfc1.md` — the Freeze Surface inventory the Tier M/Tier C split is measured against.
- `proof-package-2-spec.md` / `cal-to-w5-mapping-review.md` — the Registry / live-W5 groundwork (Tier M).
