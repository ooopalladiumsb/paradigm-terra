# Gate #2 — ns/op benchmark baseline (plan + target table)

**Status:** Plan, not yet executed. Harness build deferred to a fresh session (measurement
quality matters more than speed; a noisy baseline is worse than none). This file is the
starting point so the work resumes cleanly.

**Gate (README PFC-1 → Freeze gates #2):** §C.3 ns/op CPU benchmarks built, and every cell within
`[0.5×, 2.0×]` of its abstract unit weight.

## Discipline (hard) — MEASURE, do not optimize

> Goal is a stable **baseline**, not tuning. Trap to avoid: measure → see a number → start
> refactoring → lose freeze trajectory.

- Out-of-band cell ⇒ **flag as a Tier-2-amendment candidate** (adjust the weight OR the impl) —
  do NOT change anything now.
- Wall-clock is **advisory** (§C.4): not consensus. Unit *counts* are parity-locked by
  `cal-gas/vectors/golden.json` + the diff-fuzzer and MUST NOT be touched.
- Deliverable is the populated Annex C.3 table + a baseline readme (machine, commit, conditions)
  — then a separate decision on whether anything needs intervention.

## Abstract weights (the measurement target) — extracted

DSL cost model (`dsl/src/parse.ts`): `binary:1, path_segment:2, gate_op:5, contains_key:10, size:20`.
GAS_UNITS (`cal-gas/src/units.ts`): `MCP_READ:50, MCP_WRITE:200, INVARIANT_BASE:5 (+DSL), STATE_RENT_PER_BYTE:1`.

Peg = DSL binary op = **1**. Acceptance band = `[0.5×, 2.0×]` of the weight.

| Class | abstract weight | target ratio band (×peg) |
|---|---|---|
| DSL binary op (peg) | 1 | ratio ≡ 1.00 |
| DSL path segment | 2 | [1.0, 4.0] |
| DSL gate op | 5 | [2.5, 10] |
| DSL contains_key | 10 | [5, 20] |
| DSL size | 20 | [10, 40] |
| MCP read | 50 | [25, 100] |
| MCP write | 200 | [100, 400] |
| Invariant base | 5 (+DSL cost of the expr) | [2.5, 10] |
| State-rent / byte (encode 1 KiB ÷ 1024) | 1 | [0.5, 2.0] |

These 9 classes = the §C.3 rows (currently `TBD`, lines ~985–995 of
`docs/draft/cal-execution-spec-v0.1.0-draft.md`).

## Harness design

- `tools/bench/` (TS, via `node --import tsx`), `*-rs` (criterion-free timed loop + `black_box`),
  `*-go` (`testing.B`).
- Each class exercised **in isolation** — no IO, no canonicalization folded in (except state-rent,
  where the encode IS the measured op).
- **≥100 warmup iterations, ≥1k measured, report the median ns/op.** Deterministic inputs (diff-fuzzer
  convention).
- **Defeat dead-code elimination / JIT folding:** consume the result (TS V8 + Go GC especially);
  Rust `std::hint::black_box`. A sloppy harness yields a misleading baseline — the thing we're avoiding.
- ratio = `ns(class) / ns(binary_op_peg)` per language. Normalizing to the peg removes absolute
  machine/runtime differences — we compare the **shape of the cost curve**, not absolutes.

## Steps (resume here)

1. TS reference harness — 9 classes, warmup/isolation/median → ratio table.
2. Rust harness, Go harness (independent measurement; NOT a byte-identical parity port — ns/op
   legitimately differs per runtime).
3. Populate Annex C.3 (9×3 cells: `ns / ratio`), mark each in-band / out-of-band.
4. Baseline readme (machine / commit / conditions) for reproducibility.
5. Report out-of-band cells as Tier-2 candidates — no fixes.

## PFC-1 gate status at time of writing

#1 Real Ed25519 ✅ · #3 staged validator ✅ · #4 e2e smoke (Proof Package #1 LIVE) ✅ ·
**#2 ns/op benchmarks ⬜ (this plan)** · #5 30-day quiet period ⬜.
