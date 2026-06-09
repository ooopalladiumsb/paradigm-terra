# `@paradigm-terra/m2-registry` — Registry reconciliation contract (M2-A)

> **NON-NORMATIVE operational DRAFT · Tier M · above the Freeze Surface.**
> This package does **not** change the canonical CAL semantics and is **not** part of the consensus
> Freeze Surface. It observes and records settlement facts; it decides nothing about consensus.
> Charter: [`docs/notes/m2-charter.md`](../docs/notes/m2-charter.md).

## What this is

The on-chain **Registry reconciliation contract** plus its **record schema** — the settlement-observation
leg for the already-proven `wallet.send_ton` path (PP#2, verdict A.SUCCESS). It closes the §6.4
*emission ≠ settlement* gap in `cal-to-w5-mapping-review.md`: TON settles each emitted message in a
separate async transaction, so `cal.finalized` means "validated + emitted," not "effects landed." The
Registry records, per W5 `external_message_hash`, the settlement status the **off-chain reconciler**
computes.

## Scope — M2-A (SC-1) + M2-B (SC-2) landed; M2-C deferred

| Landed | Stage | Deferred |
|---|---|---|
| contract **structure** (`contracts/reconciliation_registry.tolk`) | M2-A · SC-1 | `CAL → tx/effect → record` correlation → **M2-B / SC-3** |
| **reproducible build** (`scripts/build.ts` → `build/registry.compiled.json`) | M2-A · SC-1 | testnet deploy / network leg → **M2-C** (gated) |
| **record schema** (`src/record.ts`, mirrors the on-chain layout) | M2-A · SC-1 | |
| **build tests** (`test/build.test.ts` — determinism + round-trip) | M2-A · SC-1 | |
| **reconciler / classifier** (`src/reconcile.ts` — settled·missing·delayed·mismatch) | M2-B · SC-2 | |
| **classifier tests** (`test/reconcile.test.ts` — all four classes + ⊆ widening) | M2-B · SC-2 | |

The contract stores records but contains **no classification logic** — the status is computed
**off-chain** by `classify()` (`src/reconcile.ts`, a pure offline function) and supplied by the owner
(the reconciler) via `OP_UPSERT_RECORD`. Verb scope stays strictly `wallet.send_ton`
(`V0_1_0_ENCODABLE`); any expansion is **Tier C → PFC-2 → v2.0.0**, out of M2.

## Reproducible build (SC-1)

```bash
npm install          # pins @ton/tolk-js@1.4.1 (WASM compiler — no C toolchain) + @ton/core@0.63.1
npm run build        # → build/registry.compiled.json  (codeHashHex is the determinism anchor)
npm run typecheck
npm test             # SC-1: compiles · deterministic hash · committed artifact == fresh build · schema round-trip
```

`build/registry.compiled.json` is **committed** as the SC-1 evidence; `test/build.test.ts` fails if a
fresh compile drifts from it. In CI this runs via `make m2-registry`.

## Schemas

**Storage (c4):** `owner: address · recordCount: uint32 · records: dict<uint256 extMsgHash → ^Record>`

**Record (one settlement entry, carried/stored as a ref cell — 872 bits):**
`status: uint8 · nonce: uint64 · calHash: uint256 · txHash: uint256 · observedEffectHash: uint256 · updatedAt: uint32`

**Status codes** (`SettlementStatus`, mirrored on-chain): `1 Settled · 2 Missing · 3 Delayed · 4 Mismatch`
(`0 Unknown` = absent, never stored).
