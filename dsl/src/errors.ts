/**
 * Result codes and error types for DSL v1.2.
 *
 * The five evaluation outcomes are normative (Constraint DSL v1.1 §5):
 *
 *   PARSE_ERROR       (-2)  invalid JSON / malformed AST structure / scope violation
 *   VALIDATION_ERROR  (-1)  unknown operator, bad arity, type violation, cost exceeded
 *   EVALUATION_TRUE   ( 1)  constraint satisfied
 *   EVALUATION_FALSE  ( 0)  constraint not satisfied
 *   ERROR        (special)  runtime fault: div/0, overflow, missing variable, null misuse
 *
 * `EVALUATION_FALSE` ≠ `ERROR`. Per the spec, ERROR is a *local* validation
 * fault and does NOT escalate to CONSENSUS_UNCERTAINTY; a CAL whose expression
 * yields ERROR (or VALIDATION_ERROR / PARSE_ERROR) is simply rejected.
 *
 * Every implementation MUST agree on the outcome AND its reason code for the
 * same (expression, scope, bindings); this is the cross-language determinism
 * invariant (Constraint DSL v1.1 §6) enforced by the golden vectors.
 */

export const RESULT_CODE = {
  PARSE_ERROR: -2,
  VALIDATION_ERROR: -1,
  EVALUATION_FALSE: 0,
  EVALUATION_TRUE: 1,
  ERROR: 2,
} as const;

export type ResultName = keyof typeof RESULT_CODE;

/** The phase in which a fault was raised. */
export type Phase = "PARSE_ERROR" | "VALIDATION_ERROR" | "ERROR";

/**
 * A DSL fault. `phase` is the normative outcome bucket; `reason` is a stable,
 * machine-comparable sub-code (e.g. "UNKNOWN_OPERATOR", "DIV_BY_ZERO") that the
 * golden vectors pin across implementations.
 */
export class DslError extends Error {
  override readonly name = "DslError";
  readonly phase: Phase;
  readonly reason: string;

  constructor(phase: Phase, reason: string, message: string) {
    super(`[${phase}/${reason}] ${message}`);
    this.phase = phase;
    this.reason = reason;
  }
}

export function parseError(reason: string, message: string): DslError {
  return new DslError("PARSE_ERROR", reason, message);
}

export function validationError(reason: string, message: string): DslError {
  return new DslError("VALIDATION_ERROR", reason, message);
}

export function runtimeError(reason: string, message: string): DslError {
  return new DslError("ERROR", reason, message);
}
