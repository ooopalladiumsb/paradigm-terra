//! Folding the Event Log into State (mirrors `fold.ts`, §3.3/§8).

use paradigm_terra_canonical::jcs::JcsValue;

use crate::apply::apply;
use crate::state::state_root_of;

/// Fold an ordered event sequence into State from `start`.
pub fn materialize(events: &[JcsValue], start: JcsValue) -> Result<JcsValue, (&'static str, usize)> {
    let mut state = start;
    for (i, ev) in events.iter().enumerate() {
        match apply(&state, ev) {
            Ok(s) => state = s,
            Err(e) => return Err((e.code, i)),
        }
    }
    Ok(state)
}

/// STATE_ROOT after each event, stopping at the first ApplyError.
pub fn scan_state_roots(events: &[JcsValue], start: JcsValue) -> (Vec<[u8; 32]>, Option<(&'static str, usize)>) {
    let mut roots = Vec::new();
    let mut state = start;
    for (i, ev) in events.iter().enumerate() {
        match apply(&state, ev) {
            Ok(s) => {
                state = s;
                match state_root_of(&state) {
                    Ok(r) => roots.push(r),
                    Err(_) => return (roots, Some(("STATE_ROOT", i))),
                }
            }
            Err(e) => return (roots, Some((e.code, i))),
        }
    }
    (roots, None)
}
