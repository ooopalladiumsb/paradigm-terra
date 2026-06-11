//! Execution-trace inputs for the validator (mirrors `trace.ts`). External MCP
//! step results arrive here as a deterministic record (CAL Spec §4.1).

use paradigm_terra_canonical::jcs::JcsValue;
use paradigm_terra_cal_gas::U256;

/// One step's observed outcome: success flag + the deltas it produced.
pub struct StepResult {
    pub ok: bool,
    pub effects: Vec<JcsValue>,
    pub error_detail: Option<String>,
}

/// The deterministic record of an external execution, fed into `validate`.
pub struct ExecutionTrace {
    /// Tick at which validation runs (vs `cal.expiration_tick`, §3.4).
    pub current_tick: U256,
    /// One entry per `cal.steps`, in order.
    pub steps: Vec<StepResult>,
    /// State bound to `state.before.*` (and bare `state.*` in post/invariants).
    pub state_before: JcsValue,
    /// Post-execution state bound to `state.after.*`.
    pub state_after: JcsValue,
    /// Whether a valid operator_sig is present over the CAL's canonical-unsigned
    /// payload (§8.1, §8.3). Structural-only at this layer: the trace carries
    /// the node's verifier verdict; real Ed25519 curve arithmetic is deferred.
    pub operator_sig_present: bool,
    /// Whether a valid owner_sig co-signature is present (§8.2 structural check).
    pub owner_sig_present: bool,
    /// PFC2-M5 (Multisig v2.1): the node's per-envelope owner-match verdicts for a v2 owners[]
    /// agent, in PRESENTED ORDER — the matched owner pubkey, or "" for no valid match. `None` ⇒
    /// a v1 single-owner record (the legacy owner_sig_present gate applies). `validate` stays pure
    /// over this (it sorts/dedupes/counts; it does not verify signatures). Mirrors `ownerSigners`.
    pub owner_signers: Option<Vec<String>>,
    /// Validator-local pinned MCP schema hash (§4.4). Compared to
    /// `state.registry.mcp_schema_hash`; mismatch fails the CAL with
    /// `SCHEMA_MISMATCH` (no-charge, ingress-class). Empty string = no pin.
    pub pinned_mcp_schema_hash: String,
}
