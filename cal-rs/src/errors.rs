//! CAL structural-validation error (mirrors `errors.ts` + `schema.ts`).
//!
//! `code` is a stable reason pinned by the golden vectors; `detail` carries the
//! field / nested DSL reason and is also pinned when present.

#[derive(Debug, Clone)]
pub struct CalError {
    pub code: &'static str,
    pub detail: Option<String>,
}

impl CalError {
    pub fn code(code: &'static str) -> Self {
        CalError { code, detail: None }
    }
    pub fn with(code: &'static str, detail: String) -> Self {
        CalError { code, detail: Some(detail) }
    }
}

/// Non-throwing validation outcome (mirrors `checkCal`).
#[derive(Debug, Clone)]
pub struct CheckResult {
    pub valid: bool,
    pub code: Option<&'static str>,
    pub detail: Option<String>,
}
