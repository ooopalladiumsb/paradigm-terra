/**
 * @paradigm-terra/cal — the immutable, hashable foundation of the Constitutional
 * Action Language (CAL Execution Spec v0.1.0-draft).
 *
 * This layer is everything about CAL that is computable from a blob alone:
 *   - schema:    CAL wire-format structural validation (§2.1), reusing the DSL
 *                layer to parse-validate embedded expressions (never evaluating)
 *   - hash:      CAL_HASH + canonical signing payload (§2.2/§8.3), event &
 *                receipt hashing (§5); STATE_ROOT / event-log Merkle re-exported
 *                from the canonical layer (§7.3, CE §6.3)
 *   - lifecycle: stage / event-type enums, terminal set, transition table,
 *                reason codes (§3)
 *   - events:    canonical receipt builders (§5)
 *
 * Deferred to later phases (and intentionally absent): the `apply` reducer
 * (§7.1), gas accounting (§9), signature verification, validator snapshot /
 * capability checks (§4), and Bounded-Mode runtime (§10).
 */

export * from "./errors.js";
export * from "./lifecycle.js";
export * from "./schema.js";
export * from "./hash.js";
export * from "./events.js";
