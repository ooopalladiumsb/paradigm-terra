/**
 * @paradigm-terra/cal-reducer — the deterministic CAL event reducer (CAL Spec
 * §7.1). `apply(State, Event) → State` as a pure total fold with per-CAL effect
 * staging (all-or-nothing). Events are self-describing: economic values and step
 * effects (Deltas) are carried in the event, so the reducer never evaluates DSL,
 * prices gas, or touches an external — making it byte-for-byte deterministic.
 *
 * Design note: ../docs/notes/cal-reducer-design.md. Built on @paradigm-terra/
 * canonical (STATE_ROOT §7.3) and @paradigm-terra/cal (lifecycle/event vocab).
 * The gas-pricing and validator-decision phases are separate.
 */

export * from "./state.js";
export * from "./errors.js";
export * from "./delta.js";
export * from "./apply.js";
export * from "./fold.js";
export * from "./migrate.js";
