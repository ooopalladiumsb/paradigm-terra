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
   * Whether a valid `operator_sig` is present over `canonical_bytes(cal_without_signatures)`
   * (§8.1, §8.3). The trace carries the node's verifier verdict; `validate()` stays pure over
   * this boolean. The verdict lands in `owner-sig.ts` `operatorSigPresent(...)` — a RAW Ed25519
   * verify (the agent runtime signs programmatically with its operator key; no wallet, no
   * Contract A) — computed BEFORE the trace is built, not inside `validate()`.
   */
  readonly operatorSigPresent: boolean;
  /**
   * Whether a valid `owner_sig` co-signature is present (§8.2). Verdict lands in `owner-sig.ts`
   * `ownerSigPresent(env, owner_pubkey)` via Contract A (`TC_V2_SIGNDATA_VERIFY_V1`, TON Connect
   * signData/binary, D1) — computed before the trace is built, not inside `validate()`.
   */
  readonly ownerSigPresent: boolean;
  /**
   * PFC-2 (Multisig v2.1, `pfc2-m1-multisig-semantics.md` §1.3): the node's per-envelope
   * owner-match verdict for a multi-owner agent. One entry per presented `owner_sigs[]`
   * envelope, IN PRESENTED ORDER: the matched `owners[]` pubkey if that envelope's Contract-A
   * commit verified against a registry owner, else the empty string `""` (no valid owner match).
   *
   * Implementation refinement of M1 §1.3 (which described a "distinct verified set"): the
   * validator needs the PRESENTED SEQUENCE — not a pre-deduped set — to decide
   * `INVALID_SIGNATURE_SET` (unsorted / duplicate / non-owner / cardinality) vs `QUORUM_NOT_MET`
   * (well-formed but sub-threshold). The node computes each entry via the existing
   * `owner-sig.ts` `computeOwnerSigners(...)`; `validate()` stays PURE over this array (it sorts/
   * dedupes/counts, it does not verify signatures). Absent/`undefined` ⇒ the agent is a v1
   * single-owner record and the legacy `ownerSigPresent` gate applies (migration is PFC2-M3).
   */
  readonly ownerSigners?: readonly string[];
  /**
   * Validator-local pinned MCP schema hash (§4.4). Compared to
   * `state.registry.mcp_schema_hash`; mismatch fails the CAL with
   * `SCHEMA_MISMATCH` (no-charge, ingress-class). The empty string means
   * "this validator has no pin configured" → gate is skipped.
   */
  readonly pinnedMcpSchemaHash?: string;
}
