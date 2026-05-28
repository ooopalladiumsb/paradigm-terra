/**
 * Execution-trace inputs for the validator (CAL Spec §4.1: validators do not
 * execute steps). The external, non-deterministic MCP step results arrive here
 * as a deterministic record, so validation stays a pure function.
 */

import type { Json } from "@paradigm-terra/cal-gas";

export type { Json };

/** One step's observed outcome: success flag + the deltas it produced. */
export interface StepResult {
  readonly ok: boolean;
  /** Canonical Deltas `{ns, op, path, value?}` staged for commit at finalize. */
  readonly effects: readonly Json[];
  /** Detail for `STEP_ERROR` when `ok` is false (informational). */
  readonly errorDetail?: string;
}

/** The deterministic record of an external execution, fed into `validate`. */
export interface ExecutionTrace {
  /** Tick at which validation runs (vs `cal.expiration_tick`, §3.4). */
  readonly currentTick: bigint;
  /** One entry per `cal.steps`, in order. */
  readonly steps: readonly StepResult[];
  /** State bound to `state.before.*` (and bare `state.*` in post/invariants). */
  readonly stateBefore: Json;
  /** Post-execution state bound to `state.after.*`. */
  readonly stateAfter: Json;
  /**
   * Whether a valid `operator_sig` is present over the CAL's canonical-unsigned
   * payload (§8.1, §8.3). Structural-only at this layer: the trace carries the
   * node's verifier verdict; real Ed25519 curve arithmetic is performed outside
   * the validator (deferred).
   */
  readonly operatorSigPresent: boolean;
  /** Whether a valid `owner_sig` co-signature is present (§8.2 structural check). */
  readonly ownerSigPresent: boolean;
  /**
   * Validator-local pinned MCP schema hash (§4.4). Compared to
   * `state.registry.mcp_schema_hash`; mismatch fails the CAL with
   * `SCHEMA_MISMATCH` (no-charge, ingress-class). The empty string means
   * "this validator has no pin configured" → gate is skipped.
   */
  readonly pinnedMcpSchemaHash?: string;
}
