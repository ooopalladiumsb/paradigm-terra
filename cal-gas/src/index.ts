/**
 * @paradigm-terra/cal-gas — deterministic CAL gas pricing & accounting
 * (CAL Execution Spec §9): the gas-unit model (reusing the DSL cost model),
 * nano-PTRA pricing, the upfront escrow gate (§9.3), and the per-outcome
 * refund/retention bill (§9.4). Pure functions — the validator wires the
 * resulting values into events; the reducer moves them.
 *
 * Design note: ../docs/notes/cal-gas-design.md. Built on @paradigm-terra/
 * canonical and @paradigm-terra/dsl.
 */

export * from "./util.js";
export * from "./units.js";
export * from "./pricing.js";
export * from "./settle.js";
