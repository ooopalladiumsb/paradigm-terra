//! Error type for the gas layer: a DSL fault (cost model rejects an expression)
//! or a canonical-encoding fault (effects serialization). Mirrors the fact that
//! in TS these surface as thrown `DslError` / `CanonicalError`.

use paradigm_terra_canonical::CanonicalError;
use paradigm_terra_dsl::DslError;

#[derive(Debug, Clone)]
pub enum GasError {
    Dsl(DslError),
    Canonical(CanonicalError),
}

impl From<DslError> for GasError {
    fn from(e: DslError) -> Self {
        GasError::Dsl(e)
    }
}

impl From<CanonicalError> for GasError {
    fn from(e: CanonicalError) -> Self {
        GasError::Canonical(e)
    }
}

pub type GasResult<T> = Result<T, GasError>;
