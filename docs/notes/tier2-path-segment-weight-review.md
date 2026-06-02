# Tier-2 review proposal — PATH_SEGMENT_WEIGHT_REVIEW

**Status:** OPEN — parked for the PFC-1 quiet period. No change made; this is a proposal, not an
amendment. Decision deferred to quiet-period close (see PFC-1 gate #5). If no contradicting data
appears in 30 days, decide then.

**Origin:** Gate #2 ns/op baseline, 2026-06-02 (`gate2-baseline-results.md`, Annex C.3, commit
`a86857e`). The MEASURE-not-optimize discipline forbade changing anything at measurement time; this
file is the designated parking spot for the one systematic finding.

## The finding

`path_segment` (abstract weight **2**) is out of band **low in all three reference runtimes**:

| | TS | Rust | Go |
|---|--:|--:|--:|
| ratio vs binary-op peg | 0.24 | 0.05 | 0.46 |
| band ([0.5×, 2.0×] of weight 2) | [1, 4] | [1, 4] | [1, 4] |

A path-segment marginal (one property descent during evaluation) costs a *fraction* of a binary
comparison in every tree-walker — not 2× more. Because the deviation is simultaneous across
TS/Rust/Go, it is **not** a runtime-specific anomaly: it is a systematic over-weight of
`path_segment` relative to actual evaluation CPU.

## Why it is NOT a freeze blocker

Per Exec-spec §C.4, the consensus-binding artifact is the unit **count** per operation
(`dsl/src/parse.ts` COST, parity-locked by `cal-gas/vectors/golden.json` + the diff-fuzzer). The
wall-clock columns are **advisory**. The cost model is a semantic / anti-grief weighting (it prices
the *attack surface* of deep path expressions), not a CPU model — the two need not coincide within
2×. Lowering `path_segment` would change a consensus-locked count and ripple into every cached gas
vector. That cost is real; the benefit (CPU realism of an advisory column) is not.

## Options at decision time

1. **No change (default / recommended).** Keep `path_segment = 2` as an anti-grief weight; annotate
   Annex C.3 that path-segment is intentionally priced above its CPU cost to bound deep-path
   expression abuse. Cost: nil. Risk: nil. Re-grades Gate #2 to ✅ by treating the band as
   advisory-only for this row, which §C.4 already permits.
2. **Lower the weight toward ~0.5–1.** Brings the advisory ratio in-band. Cost: a Tier-2 amendment
   touching `dsl` COST in TS/Rust/Go + regenerating all gas golden vectors + re-running the
   diff-fuzzer + an Annex C.1 edit. Only worth it if a concrete griefing analysis shows weight 2 is
   *not* needed for path-depth abuse bounds.

## Decision criteria (evaluate at quiet-period close)

- Did any other data (fuzzer, adversarial CAL, a real workload) show deep-path expressions are a
  griefing vector that weight 2 is actively defending? → keep (Option 1).
- Is there a pending Annex C.1 amendment already touching DSL weights for another reason? → fold the
  re-balance in then (Option 2), never as a standalone churn.
- Default if neither: **Option 1, no change** — advisory mismatch is acceptable under §C.4.

## Related

- `gate2-baseline-results.md` — full baseline, conditions, the other (non-systematic) cells.
- `cal-execution-spec-v0.1.0-draft.md` §C.3 (table + finding) / §C.4 (advisory discipline).
