/**
 * @paradigm-terra/dsl — reference implementation of DSL v1.2.
 *
 * DSL v1.2 = Constraint DSL v1.1 (frozen) + the CAL v0.1.0-draft extensions:
 * bracketed state (`state.before/after`), action references, capability-gate
 * operators, and the Bounded-Mode emergency invariant set. Every v1.1 expression
 * evaluates identically under v1.2; only the hash domain tag differs.
 *
 * Public surface:
 *   - ast:       Expr node types, Scope, DslVersion, AST limits
 *   - errors:    result-code model + DslError
 *   - values:    runtime value model + type system
 *   - taxonomy:  registered action enum + owner-required / required-scope tables
 *   - parse:     parseExpression / expressionCost (structural validation)
 *   - evaluate:  evaluate / run (total evaluator)
 *   - hash:      dslHash (DSL_HASH per spec §4 / §8.1)
 *   - envelope:  parseEnvelope ({dsl_version, expr})
 *   - emergency: EMERGENCY_INVARIANTS / effectiveInvariants (Bounded Mode)
 */

export * from "./ast.js";
export * from "./errors.js";
export * from "./values.js";
export * from "./taxonomy.js";
export * from "./parse.js";
export * from "./evaluate.js";
export * from "./hash.js";
export * from "./envelope.js";
export * from "./emergency.js";
