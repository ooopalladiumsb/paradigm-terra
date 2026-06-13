# Release notes — v2.2.0 (Layer 2: on-chain observational suite)

**Date:** 2026-06-13 · **Line:** 2.x (above the Freeze Surface) · **Tag:** `v2.2.0`

A **MINOR** release: **Layer 2** — the on-chain face of the frozen protocol. A suite of observational
read-model contracts (Tolk) + a deterministic genesis, built on a pinned `@ton/tolk-js` harness. No freeze
line changes: `freeze-gate` byte-identical throughout (Tier-M).

## The one rule it encodes — Framing A (ratified)

```
Layer 2 contracts MUST NOT become a source of consensus truth.
Layer 2 contracts ARE projections of frozen consensus state.
```

The off-chain fold (`CAL → validator → reducer → orchestrator → STATE_ROOT`) stays authoritative; these
contracts mirror it on-chain so external parties can read/prove state and link it to published anchors.
Framing B (authoritative on-chain state) is explicitly a future PFC-3 / v3.0.0, not this release.

## What shipped (`tolk/`)

| Component | Contract | Invariant | Golden codeHash |
|---|---|---|---|
| **L2.0** harness | — | reproducible `@ton/tolk-js` build → golden + `@ton/sandbox` tests | — |
| **L2.1** Registry | `registry.tolk` | reflects, never governs | `1ED1C543…` |
| **L2.2** Treasury | `treasury.tolk` | observes, never settles | `40DF89F7…` |
| **L2.3** FailureStateManager | `failure-state.tolk` | reflects mode, never transitions | `4B51086D…` |
| **L2.4** Capability | `capability.tolk` | reflects grants, never authorizes | `E6407A9E…` |
| **L2.5** Anchor index | `anchor-index.tolk` | indexes facts, never verifies | `F51ED423…` |
| **L2.6** Genesis | `src/genesis.ts` | deploys read-models, creates no consensus | (manifest) |

Every contract: owner-gated projection write, byte-identical read-back, a non-owner write aborts **401**,
and **no consensus/decision/settlement/authorization op exists** — any unknown op aborts **0xffff** (the
invariant is proven per contract). Genesis deploys the full suite to an all-empty initial state with five
distinct deterministic addresses.

## Toolchain note

The Layer-2 Tolk toolchain is **`@ton/tolk-js`** (WASM, pinned 1.4.1) — deterministic compilation with
golden code-hash pinning + sandbox trace tests. **Acton** (the `execution-spec §8` Rust CLI) is
**deferred-by-constraint** (no-C-toolchain environment), the same class as the PFC-1 Rust-node deferral;
the spec's recommendation is satisfied in substance.

## Scope / limits

- Offline release: every contract is build- + sandbox-proven (harness suite 28/28). **Live testnet
  deploy** of any contract or the genesis is a separate GATED step (funded operator), not in v2.2.0.
- Layer 2 is the observational/infrastructure spine. Governance / Oracle / PTRA contracts are **Layer 3**
  (each likely its own PFC freeze line, since they change consensus).

## Pointers
- Charter: `docs/notes/layer2-toolchain-charter.md` (toolchain ruling + Framing A + per-component DoD)
- CHANGELOG: `[2.2.0]`
- Package: `tolk/` (`@paradigm-terra/tolk-harness`); genesis manifest `tolk/artifacts/genesis/genesis-manifest.json`
