//! Error types for the canonical layer — parity with `errors.ts`.
//!
//! `NoncanonicalEvent` is the hard-validation error from CE v1.3 §9; any
//! condition that violates determinism (non-canonical JSON, invalid UTF-8,
//! dup keys, surrogates, fractional numbers) MUST raise it.
//!
//! `CanonicalEncoding` covers range / shape errors raised by the encoders.
//!
//! Both carry a stable string `code` (identical to the TypeScript codes) and a
//! human-readable message; `Display` renders `"[CODE] message"` exactly like
//! the TS error classes.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorClass {
    /// Mirrors `NoncanonicalEventError` in errors.ts.
    NoncanonicalEvent,
    /// Mirrors `CanonicalEncodingError` in errors.ts.
    CanonicalEncoding,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalError {
    pub class: ErrorClass,
    pub code: &'static str,
    pub message: String,
}

impl CanonicalError {
    pub fn noncanonical(code: &'static str, message: impl Into<String>) -> Self {
        CanonicalError {
            class: ErrorClass::NoncanonicalEvent,
            code,
            message: message.into(),
        }
    }

    pub fn encoding(code: &'static str, message: impl Into<String>) -> Self {
        CanonicalError {
            class: ErrorClass::CanonicalEncoding,
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for CanonicalError {}

pub type Result<T> = std::result::Result<T, CanonicalError>;
