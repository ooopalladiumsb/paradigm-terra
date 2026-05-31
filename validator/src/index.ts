/**
 * @paradigm-terra/cal-validator — the deterministic CAL validator (CAL Execution
 * Spec v0.1.0-draft §3–§9). One pure function, `validate(cal, calHashHex,
 * snapshot, trace)`, drives a SIGNED CAL through the lifecycle state machine and
 * emits the self-describing stage events the reducer consumes. It wires DSL
 * evaluation (@paradigm-terra/dsl), gas pricing & settlement
 * (@paradigm-terra/cal-gas), and capability/owner/nonce/expiration checks into
 * one verdict. It evaluates, it does not execute: external MCP step effects
 * arrive as an execution trace (§4.1).
 *
 * Design note: ../docs/notes/cal-validator-design.md.
 *
 * `owner-sig.ts` is the node-side Ed25519 verifier that produces the trace's
 * signature-presence booleans (TC_V2_SIGNDATA_VERIFY_V1 / TC_V2_TONPROOF_VERIFY_V1);
 * it runs before `validate()` and is not part of the pure verdict function.
 */

export * from "./trace.js";
export * from "./validate.js";
export * from "./owner-sig.js";
