//! Binary balanced Merkle tree per CE v1.3 §6 and CAL Execution Spec §7.3 —
//! parity with `merkle.ts`.
//!
//! - Left-balanced; for an odd leaf count the last leaf is duplicated at that
//!   level (classic Bitcoin-style binary Merkle).
//! - Leaf and node hashing use distinct domain tags.

use crate::domains;
use crate::errors::{CanonicalError, Result};
use crate::hash::{concat_bytes, domain_hash};
use crate::integers::{encode_uint16, encode_uint64};
use crate::strings::utf8_nfc_bytes;

/// Compute a binary-balanced Merkle root over pre-hashed leaves using the given
/// node domain tag. Duplicates the last node on odd levels. Errors on empty
/// input.
pub fn binary_merkle(leaf_hashes: &[[u8; 32]], node_tag: &str) -> Result<[u8; 32]> {
    if leaf_hashes.is_empty() {
        return Err(CanonicalError::encoding(
            "MERKLE_EMPTY",
            "binary Merkle over empty leaf set is undefined",
        ));
    }
    let mut level: Vec<[u8; 32]> = leaf_hashes.to_vec();
    while level.len() > 1 {
        let mut next: Vec<[u8; 32]> = Vec::with_capacity(level.len().div_ceil(2));
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { left };
            let combined = concat_bytes(&[&left, &right]);
            next.push(domain_hash(node_tag, &combined)?);
            i += 2;
        }
        level = next;
    }
    Ok(level[0])
}

// ============================================================================
// Stream tree (CE §6.3)
// ============================================================================

#[derive(Debug, Clone)]
pub struct StreamLeaf {
    pub stream_id: String,
    pub state_hash: [u8; 32],
    pub last_event_hash: [u8; 32],
    pub last_seqno: u64,
}

pub fn stream_leaf_hash(leaf: &StreamLeaf) -> Result<[u8; 32]> {
    let id_bytes = utf8_nfc_bytes(&leaf.stream_id)?;
    if id_bytes.len() > u16::MAX as usize {
        return Err(CanonicalError::encoding(
            "MERKLE_STREAM_ID_TOO_LONG",
            "streamId UTF-8 byte length exceeds uint16",
        ));
    }
    let payload = concat_bytes(&[
        &encode_uint16(id_bytes.len() as u16),
        &id_bytes,
        &leaf.state_hash,
        &leaf.last_event_hash,
        &encode_uint64(leaf.last_seqno),
    ]);
    domain_hash(domains::MERKLE_LEAF_V1, &payload)
}

/// Compute the stream-tree Merkle root (CE §6). Leaves are ordered
/// lexicographically by NFC UTF-8 `stream_id`.
pub fn stream_tree_root(leaves: &[StreamLeaf]) -> Result<[u8; 32]> {
    if leaves.is_empty() {
        return Err(CanonicalError::encoding(
            "MERKLE_EMPTY",
            "stream tree requires at least one leaf",
        ));
    }
    let mut sorted: Vec<&StreamLeaf> = leaves.iter().collect();
    sorted.sort_by(|a, b| {
        let ab = utf8_nfc_bytes(&a.stream_id).unwrap_or_default();
        let bb = utf8_nfc_bytes(&b.stream_id).unwrap_or_default();
        ab.cmp(&bb)
    });
    let mut leaf_hashes = Vec::with_capacity(sorted.len());
    for leaf in sorted {
        leaf_hashes.push(stream_leaf_hash(leaf)?);
    }
    binary_merkle(&leaf_hashes, domains::MERKLE_NODE_V1)
}

// ============================================================================
// State root (CAL Spec §7.3)
// ============================================================================

#[derive(Debug, Clone)]
pub struct StateNamespace {
    pub name: String,
    pub canonical_bytes: Vec<u8>,
}

/// Leaf hash for one namespace per CAL Spec §7.3:
///
///   leaf = SHA256(STATE_ROOT_V1 ||
///                 uint16_be(len(name)) || utf8(name) ||
///                 SHA256(STATE_V1 || canonical_bytes))
pub fn state_namespace_leaf_hash(ns: &StateNamespace) -> Result<[u8; 32]> {
    let inner = domain_hash(domains::STATE_V1, &ns.canonical_bytes)?;
    let name_bytes = utf8_nfc_bytes(&ns.name)?;
    if name_bytes.len() > u16::MAX as usize {
        return Err(CanonicalError::encoding(
            "STATE_ROOT_NAME_TOO_LONG",
            "namespace name UTF-8 length exceeds uint16",
        ));
    }
    let payload = concat_bytes(&[&encode_uint16(name_bytes.len() as u16), &name_bytes, &inner]);
    domain_hash(domains::STATE_ROOT_V1, &payload)
}

/// Compute the protocol state root over the given namespaces, ordered
/// lexicographically by NFC UTF-8 name (CAL Spec §7.3). Rejects duplicate names.
pub fn state_root(namespaces: &[StateNamespace]) -> Result<[u8; 32]> {
    if namespaces.is_empty() {
        return Err(CanonicalError::encoding(
            "STATE_ROOT_EMPTY",
            "state root requires at least one namespace",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for ns in namespaces {
        if !seen.insert(ns.name.clone()) {
            return Err(CanonicalError::encoding(
                "STATE_ROOT_DUPLICATE_NAMESPACE",
                format!("duplicate namespace {:?}", ns.name),
            ));
        }
    }
    let mut sorted: Vec<&StateNamespace> = namespaces.iter().collect();
    sorted.sort_by(|a, b| {
        let ab = utf8_nfc_bytes(&a.name).unwrap_or_default();
        let bb = utf8_nfc_bytes(&b.name).unwrap_or_default();
        ab.cmp(&bb)
    });
    let mut leaf_hashes = Vec::with_capacity(sorted.len());
    for ns in sorted {
        leaf_hashes.push(state_namespace_leaf_hash(ns)?);
    }
    binary_merkle(&leaf_hashes, domains::STATE_ROOT_V1)
}
