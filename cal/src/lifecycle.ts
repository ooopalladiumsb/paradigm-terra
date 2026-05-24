/**
 * CAL lifecycle state machine — the frozen, deterministic part (CAL Spec §3).
 *
 * This module encodes the stages, event types, terminal set, reason codes, and
 * the stage→event-type transition table as constants/pure functions. It does
 * NOT apply events to state — that is the reducer (`apply`, §7.1), a deferred
 * phase. Nothing here reads state, gas, or signatures.
 */

export const STAGES = [
  "CREATED",
  "SIGNED",
  "VALIDATED",
  "EXECUTED",
  "SETTLED",
  "FINALIZED",
  "FAILED",
  "EXPIRED",
] as const;
export type Stage = (typeof STAGES)[number];

export const TERMINAL_STAGES: readonly Stage[] = ["FINALIZED", "FAILED", "EXPIRED"];

export function isTerminal(stage: Stage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

export const EVENT_TYPES = [
  "cal.created",
  "cal.signed",
  "cal.validated",
  "cal.executed",
  "cal.settled",
  "cal.finalized",
  "cal.failed",
  "cal.expired",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Closed enum of failure reasons (CAL Spec §3.5 + §6.3 CANCELLED). */
export const REASON_CODES = [
  "PRECOND_FALSE",
  "PRECOND_ERROR",
  "CAPABILITY_DENIED",
  "NONCE_MISMATCH",
  "STEP_ERROR",
  "POSTCOND_FALSE",
  "INVARIANT_FALSE",
  "OUT_OF_GAS",
  "UNKNOWN_ACTION",
  "BOUNDED_BLOCKED",
  "SCHEMA_MISMATCH",
  "CANCELLED",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export function isReasonCode(s: string): s is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(s);
}

/** Happy-path stage transitions (CAL Spec §3.2). */
const HAPPY_PATH: Record<string, EventType> = {
  "*->CREATED": "cal.created", // external ingress
  "CREATED->SIGNED": "cal.signed",
  "SIGNED->VALIDATED": "cal.validated",
  "VALIDATED->EXECUTED": "cal.executed",
  "EXECUTED->SETTLED": "cal.settled",
  "SETTLED->FINALIZED": "cal.finalized",
};

/**
 * The canonical event type for a stage transition, or `null` if the transition
 * is not part of the lifecycle. Any non-terminal stage may transition to FAILED
 * (`cal.failed`) or EXPIRED (`cal.expired`).
 */
export function transitionEventType(from: Stage | "*", to: Stage): EventType | null {
  // Only a non-terminal stage may fail or expire (§3.1).
  const nonTerminal = from === "*" || !isTerminal(from as Stage);
  if (to === "FAILED") return nonTerminal ? "cal.failed" : null;
  if (to === "EXPIRED") return nonTerminal ? "cal.expired" : null;
  return HAPPY_PATH[`${from}->${to}`] ?? null;
}
