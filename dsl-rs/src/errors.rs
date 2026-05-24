//! Result codes and fault model for DSL v1.2 (mirrors the TS `errors.ts`).
//!
//! The normative outcome buckets (Constraint DSL v1.1 §5) are PARSE_ERROR,
//! VALIDATION_ERROR, EVALUATION_TRUE/FALSE, and ERROR. Every implementation must
//! agree on the outcome AND its stable `reason` sub-code; the golden vectors pin
//! both. The `reason` strings here are byte-identical to the TypeScript
//! reference.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Parse,
    Validation,
    Runtime,
}

impl Phase {
    pub fn code(self) -> &'static str {
        match self {
            Phase::Parse => "PARSE_ERROR",
            Phase::Validation => "VALIDATION_ERROR",
            Phase::Runtime => "ERROR",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DslError {
    pub phase: Phase,
    pub reason: &'static str,
}

impl DslError {
    pub fn parse(reason: &'static str) -> Self {
        DslError { phase: Phase::Parse, reason }
    }
    pub fn validation(reason: &'static str) -> Self {
        DslError { phase: Phase::Validation, reason }
    }
    pub fn runtime(reason: &'static str) -> Self {
        DslError { phase: Phase::Runtime, reason }
    }
}

pub type DResult<T> = Result<T, DslError>;
