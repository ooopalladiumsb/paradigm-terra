# Roadmap v1.x — post-release (after v1.0.0)

**Date:** 2026-06-09 · Follows the inaugural release `v1.0.0` (`release-signoff-v1.0.0.md`,
`release-notes-v1.0.0.md`), riding `pfc1-consensus-freeze`. The project has moved from *preparing a
release* to *maintaining a released line*. This document is the post-release backlog and, more
importantly, the **rule for where each item is allowed to land**.

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
| **Registry deployment** | deploy the on-chain Registry contract + the live `ir_to_boc` / external-message leg beyond the proven `send_ton` path | MINOR | deferred at PP#2 (not needed for the `send_ton` proof); `cal-to-w5-mapping-review.md` is the groundwork. Integration Reality Risk, not Freeze Surface. |
| **`rust-parity` runner stabilization** | provision the CI runner for the repo's musl-static / `rust-lld` build so the optional `rust-parity` job goes green, then **promote it to required** | PATCH→policy | the second CI finding (`release-gate.md §CI findings`): RED is purely environmental, locally green across all 8 crates. |
| **Remote / incremental backups** | extend PR-1.7 local backup→restore to off-host and incremental (snapshot + WAL deltas) | MINOR | operational durability; the round-trip-to-identical-`STATE_ROOT` invariant is the acceptance bar. |
| **WAL archival / compaction** | bound on-disk growth: archive/compact the event log behind snapshots without breaking byte-exact replay | MINOR | must preserve §7.2 replayability — compaction is an operational concern, the root values are unchanged. |
| **Distributed observers** | scale PR-1.8's single live observer to multiple independent tailers (consensus on the published root) | MINOR | strengthens H3.5-live into a fleet; observe-only, decides nothing. |
| **Long-duration soak program** | run the 7–30 day continuous soak the PR-1 charter named (PR-1.9 proved the gate over 120 ticks) | PATCH/process | zero root drift + zero Freeze-Surface defect remains the bar; a scheduled, ongoing program rather than a one-shot. |
| **`path_segment` gas — advisory** | the one §C.3 weight out of band in all three tree-walkers (Gate #2 baseline) — *measure only* on the 1.x line | PATCH | the unit **counts** are consensus-locked anti-grief weights (§C.4); a re-weight is **not** a 1.x change — it is Tier C. |

## Tier C — Consensus expansion (a NEW freeze line: PFC-2 → 2.0.0)

Anything here touches the Freeze Surface and therefore **cannot** ride the 1.x line. Each requires the
full freeze-adjacent process (`release-governance.md §Freeze-Adjacent Changes`): a separate review, a
dedicated freeze branch, regenerated evidence (vectors re-promoted to NORMATIVE, Proof Package
re-verified in TS *and* Go), and an explicit new freeze decision (`pfc2-consensus-freeze`). The release
that carries it is `2.0.0`.

- **New verb classes** — jetton, nft, bounded-mode beyond the frozen set, etc. New verbs change validator
  / reducer / gas semantics ⇒ Freeze Surface.
- **Multi-owner (Multisig v2.1) flows** — a new ownership/authorization model ⇒ consensus.
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
