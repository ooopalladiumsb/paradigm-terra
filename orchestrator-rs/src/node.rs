//! The deterministic node (CAL Exec Spec §6/§7 + Canonical Encoding §6.3). Rust
//! parity port of `src/node.ts`; see the crate docs and `docs/notes/orchestrator-design.md`.

use paradigm_terra_cal::{cal_hash, event_hash};
use paradigm_terra_cal_gas::U256;
use paradigm_terra_cal_reducer::{apply, state_root_of};
use paradigm_terra_cal_validator::{validate, ExecutionTrace, StepResult};
use paradigm_terra_canonical::integers::to_hex_prefixed;
use paradigm_terra_canonical::jcs::JcsValue;
use paradigm_terra_canonical::merkle::{stream_tree_root, StreamLeaf};
use paradigm_terra_canonical::CanonicalError;

#[derive(Debug, Clone)]
pub struct NodeError {
    pub code: &'static str,
    pub detail: String,
}

fn node_err(code: &'static str, detail: impl Into<String>) -> NodeError {
    NodeError { code, detail: detail.into() }
}
fn canon_err(e: CanonicalError) -> NodeError {
    NodeError { code: "CANON_ERROR", detail: format!("{e:?}") }
}

pub struct Submission {
    pub cal: JcsValue,
    pub trace: ExecutionTrace,
}
pub struct TickBlock {
    pub tick: U256,
    pub submissions: Vec<Submission>,
}
pub struct Program {
    pub genesis_state: JcsValue,
    pub ticks: Vec<TickBlock>,
}

#[derive(Debug, Clone)]
pub struct SubmissionResult {
    pub cal_hash: String,
    pub agent_id: String,
    /// `None` when rejected at ingress (cal.created/cal.signed) before validation.
    pub terminal_stage: Option<String>,
    pub reason_code: Option<String>,
    pub event_types: Vec<String>,
    /// STATE_ROOT (0x-hex) after each recorded event.
    pub state_roots: Vec<String>,
    pub ingress_error: Option<String>,
}
pub struct TickResult {
    pub tick: U256,
    pub submissions: Vec<SubmissionResult>,
    pub state_root: String,
    pub global_merkle_root: String,
}
pub struct Transcript {
    pub genesis_state: JcsValue,
    pub ticks: Vec<TickResult>,
    pub event_log: Vec<JcsValue>,
    pub final_state_root: String,
}

fn hex32(b: &[u8; 32]) -> String {
    to_hex_prefixed(b)
}

fn current_tick_of(state: &JcsValue) -> U256 {
    match state.get("tick").and_then(|t| t.get("current")) {
        Some(JcsValue::Int(s)) => U256::from_dec_str(s).unwrap_or(U256::ZERO),
        _ => U256::ZERO,
    }
}

fn str_field(obj: &JcsValue, key: &str) -> Result<String, NodeError> {
    match obj.get(key) {
        Some(JcsValue::Str(s)) => Ok(s.clone()),
        _ => Err(node_err("BAD_CAL", format!("{key} must be a string"))),
    }
}

/// CE §6.3 global Merkle root over a single `"global"` stream (v0.1.0; the
/// constitution's multi-stream list drops in later).
fn global_merkle_root(state: &JcsValue, log: &[JcsValue]) -> Result<String, NodeError> {
    let last_event_hash = match log.last() {
        Some(ev) => event_hash(ev).map_err(canon_err)?,
        None => [0u8; 32],
    };
    let leaf = StreamLeaf {
        stream_id: "global".to_string(),
        state_hash: state_root_of(state).map_err(canon_err)?,
        last_event_hash,
        last_seqno: log.len() as u64,
    };
    Ok(hex32(&stream_tree_root(&[leaf]).map_err(canon_err)?))
}

fn obj(pairs: Vec<(&str, JcsValue)>) -> JcsValue {
    JcsValue::object(pairs)
}

/// Re-run `validate` against the live state with `current_tick` pinned to the node's
/// tick (a submission must not misreport the tick to dodge expiration).
fn trace_at(src: &ExecutionTrace, tick: &U256) -> ExecutionTrace {
    ExecutionTrace {
        current_tick: tick.clone(),
        steps: src
            .steps
            .iter()
            .map(|s| StepResult { ok: s.ok, effects: s.effects.clone(), error_detail: s.error_detail.clone() })
            .collect(),
        state_before: src.state_before.clone(),
        state_after: src.state_after.clone(),
        owner_sig_present: src.owner_sig_present,
        pinned_mcp_schema_hash: src.pinned_mcp_schema_hash.clone(),
    }
}

/// Run a program to a transcript. Errors on a tick regression or a validator-emitted
/// event the reducer rejects (an integration defect).
pub fn run(program: &Program) -> Result<Transcript, NodeError> {
    let genesis_state = program.genesis_state.clone();
    let mut state = genesis_state.clone();
    let mut log: Vec<JcsValue> = Vec::new();
    let mut ticks: Vec<TickResult> = Vec::new();
    let mut current_tick = current_tick_of(&state);

    for block in &program.ticks {
        if block.tick < current_tick {
            return Err(node_err("TICK_REGRESSION", format!("block tick {} < current {}", block.tick.to_dec_str(), current_tick.to_dec_str())));
        }
        if block.tick > current_tick {
            let adv = obj(vec![("event_type", JcsValue::string("tick.advanced")), ("new_tick", JcsValue::Int(block.tick.to_dec_str()))]);
            state = apply(&state, &adv).map_err(|e| node_err("TICK_REJECTED", e.code))?;
            log.push(adv);
            current_tick = block.tick.clone();
        }

        let mut subs: Vec<SubmissionResult> = Vec::new();
        for sub in &block.submissions {
            let cal_hash_hex = to_hex_prefixed(&cal_hash(&sub.cal).map_err(canon_err)?);
            let agent_id = str_field(&sub.cal, "agent_id")?;
            let mut event_types: Vec<String> = Vec::new();
            let mut state_roots: Vec<String> = Vec::new();

            // Ingress: cal.created then cal.signed (reducer enforces §6.1 / uniqueness).
            let mut ingress_error: Option<String> = None;
            for ev in [
                obj(vec![("event_type", JcsValue::string("cal.created")), ("cal_hash", JcsValue::string(&cal_hash_hex)), ("agent_id", JcsValue::string(&agent_id))]),
                obj(vec![("event_type", JcsValue::string("cal.signed")), ("cal_hash", JcsValue::string(&cal_hash_hex))]),
            ] {
                match apply(&state, &ev) {
                    Ok(ns) => {
                        state = ns;
                        let et = ev.get("event_type").and_then(JcsValue::as_str).unwrap_or("?").to_string();
                        log.push(ev);
                        event_types.push(et);
                        state_roots.push(hex32(&state_root_of(&state).map_err(canon_err)?));
                    }
                    Err(e) => {
                        ingress_error = Some(e.code.to_string());
                        break;
                    }
                }
            }
            if let Some(code) = ingress_error {
                subs.push(SubmissionResult { cal_hash: cal_hash_hex, agent_id, terminal_stage: None, reason_code: None, event_types, state_roots, ingress_error: Some(code) });
                continue;
            }

            // Validate against the live state (tick pinned), then fold the events.
            let trace = trace_at(&sub.trace, &current_tick);
            let res = validate(&sub.cal, &cal_hash_hex, &state, &trace).map_err(|e| node_err("VALIDATE_ERROR", format!("{e:?}")))?;
            for ev in &res.events {
                match apply(&state, ev) {
                    Ok(ns) => state = ns,
                    Err(e) => return Err(node_err("APPLY_FAILED", format!("{} event {} rejected: {}", res.terminal_stage, ev.get("event_type").and_then(JcsValue::as_str).unwrap_or("?"), e.code))),
                }
                log.push(ev.clone());
                event_types.push(ev.get("event_type").and_then(JcsValue::as_str).unwrap_or("?").to_string());
                state_roots.push(hex32(&state_root_of(&state).map_err(canon_err)?));
            }
            subs.push(SubmissionResult {
                cal_hash: cal_hash_hex,
                agent_id,
                terminal_stage: Some(res.terminal_stage.to_string()),
                reason_code: res.reason_code.map(str::to_string),
                event_types,
                state_roots,
                ingress_error: None,
            });
        }

        ticks.push(TickResult {
            tick: current_tick.clone(),
            submissions: subs,
            state_root: hex32(&state_root_of(&state).map_err(canon_err)?),
            global_merkle_root: global_merkle_root(&state, &log)?,
        });
    }

    let final_state_root = hex32(&state_root_of(&state).map_err(canon_err)?);
    Ok(Transcript { genesis_state, ticks, event_log: log, final_state_root })
}

/// Re-fold an event log from a start state and return the final STATE_ROOT (§7.2).
pub fn replay(event_log: &[JcsValue], genesis_state: &JcsValue) -> Result<String, NodeError> {
    let mut state = genesis_state.clone();
    for ev in event_log {
        state = apply(&state, ev).map_err(|e| node_err("REPLAY_FAILED", e.code))?;
    }
    Ok(hex32(&state_root_of(&state).map_err(canon_err)?))
}
