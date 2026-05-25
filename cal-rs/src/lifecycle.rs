//! CAL lifecycle constants + transition table (mirrors `lifecycle.ts`, §3).

pub const STAGES: &[&str] = &[
    "CREATED", "SIGNED", "VALIDATED", "EXECUTED", "SETTLED", "FINALIZED", "FAILED", "EXPIRED",
];
pub const TERMINAL_STAGES: &[&str] = &["FINALIZED", "FAILED", "EXPIRED"];

pub fn is_terminal(stage: &str) -> bool {
    TERMINAL_STAGES.contains(&stage)
}

pub const EVENT_TYPES: &[&str] = &[
    "cal.created", "cal.signed", "cal.validated", "cal.executed", "cal.settled", "cal.finalized",
    "cal.failed", "cal.expired",
];

pub const REASON_CODES: &[&str] = &[
    "PRECOND_FALSE", "PRECOND_ERROR", "CAPABILITY_DENIED", "NONCE_MISMATCH", "STEP_ERROR",
    "POSTCOND_FALSE", "INVARIANT_FALSE", "OUT_OF_GAS", "UNKNOWN_ACTION", "BOUNDED_BLOCKED",
    "SCHEMA_MISMATCH", "CANCELLED",
];

/// Canonical event type for a stage transition, or `None` if not a valid
/// lifecycle transition. `from == "*"` denotes external ingress.
pub fn transition_event_type(from: &str, to: &str) -> Option<&'static str> {
    let non_terminal = from == "*" || !is_terminal(from);
    if to == "FAILED" {
        return if non_terminal { Some("cal.failed") } else { None };
    }
    if to == "EXPIRED" {
        return if non_terminal { Some("cal.expired") } else { None };
    }
    match (from, to) {
        ("*", "CREATED") => Some("cal.created"),
        ("CREATED", "SIGNED") => Some("cal.signed"),
        ("SIGNED", "VALIDATED") => Some("cal.validated"),
        ("VALIDATED", "EXECUTED") => Some("cal.executed"),
        ("EXECUTED", "SETTLED") => Some("cal.settled"),
        ("SETTLED", "FINALIZED") => Some("cal.finalized"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transitions() {
        assert_eq!(transition_event_type("SIGNED", "VALIDATED"), Some("cal.validated"));
        assert_eq!(transition_event_type("SETTLED", "FINALIZED"), Some("cal.finalized"));
        assert_eq!(transition_event_type("VALIDATED", "FAILED"), Some("cal.failed"));
        assert_eq!(transition_event_type("CREATED", "EXPIRED"), Some("cal.expired"));
        assert_eq!(transition_event_type("FINALIZED", "EXPIRED"), None);
        assert_eq!(transition_event_type("CREATED", "FINALIZED"), None);
    }
}
