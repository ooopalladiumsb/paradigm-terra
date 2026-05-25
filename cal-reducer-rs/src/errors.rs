//! Reducer fault model (mirrors `errors.ts`). `apply` is total: it returns
//! `Result<JcsValue, ApplyError>`; codes are pinned by the golden vectors.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyError {
    pub code: &'static str,
}

impl ApplyError {
    pub fn new(code: &'static str) -> Self {
        ApplyError { code }
    }
}

pub type AResult = Result<paradigm_terra_canonical::jcs::JcsValue, ApplyError>;
