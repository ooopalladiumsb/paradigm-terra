//! Binary framing per CE v1.3 §8.1 — parity with `framing.ts`.
//!
//!   [type_tag: uint16 BE][version: uint16 BE][length: uint32 BE][payload bytes]
//!
//! `length` MUST equal `payload.len()` and MUST NOT exceed 2^32 - 1.
//! Reserved type tags: 0x0000–0x00FF (system).

use crate::errors::{CanonicalError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub type_tag: u16,
    pub version: u16,
    pub payload: Vec<u8>,
}

pub fn encode_frame(type_tag: u16, version: u16, payload: &[u8]) -> Result<Vec<u8>> {
    let len = payload.len();
    if len > u32::MAX as usize {
        return Err(CanonicalError::encoding(
            "FRAME_PAYLOAD_TOO_LARGE",
            format!("payload length {len} exceeds 2^32-1"),
        ));
    }
    let mut out = Vec::with_capacity(8 + len);
    out.extend_from_slice(&type_tag.to_be_bytes());
    out.extend_from_slice(&version.to_be_bytes());
    out.extend_from_slice(&(len as u32).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

pub fn decode_frame(bytes: &[u8]) -> Result<Frame> {
    if bytes.len() < 8 {
        return Err(CanonicalError::encoding(
            "FRAME_TOO_SHORT",
            format!("frame must be at least 8 bytes, got {}", bytes.len()),
        ));
    }
    let type_tag = u16::from_be_bytes([bytes[0], bytes[1]]);
    let version = u16::from_be_bytes([bytes[2], bytes[3]]);
    let len = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    if bytes.len() != 8 + len {
        return Err(CanonicalError::encoding(
            "FRAME_LENGTH_MISMATCH",
            format!(
                "declared length {len} does not match actual payload length {}",
                bytes.len() - 8
            ),
        ));
    }
    Ok(Frame {
        type_tag,
        version,
        payload: bytes[8..].to_vec(),
    })
}
