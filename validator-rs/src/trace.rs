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
    /// Whether a valid owner_sig co-signature is present (§8.2 structural check).
    pub owner_sig_present: bool,
}
