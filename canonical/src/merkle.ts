/**
 * Binary balanced Merkle tree per CE v1.3 §6 and CAL Execution Spec §7.3.
 *
 *   - Left-balanced.
 *   - For odd leaf count, the last leaf is duplicated at that level
 *     (classic Bitcoin-style binary Merkle).
 *   - Leaf hashing and node hashing use distinct domain tags supplied by caller.
 *
 * Two specialized constructors are exposed:
 *
 *   streamTreeRoot(streams) — CE §6.3 leaf format:
 *     LEAF = SHA256(MERKLE_LEAF_V1 || uint16_be(len(id)) || utf8(id) ||
 *                   state_hash || last_event_hash || uint64_be(last_seqno))
 *
 *   stateRoot(namespaces) — CAL Spec §7.3 leaf format:
 *     LEAF = SHA256(STATE_ROOT_V1 || uint16_be(len(name)) || utf8(name) ||
 *                   SHA256(STATE_V1 || canonical_bytes(state[name])))
 */

import { CanonicalEncodingError } from "./errors.js";
import { DOMAIN_TAGS } from "./domains.js";
import { concatBytes, domainHash } from "./hash.js";
import { encodeUint16, encodeUint64 } from "./integers.js";
import { utf8NfcBytes } from "./strings.js";

// ============================================================================
// Generic binary Merkle
// ============================================================================

/**
 * Compute a binary-balanced Merkle root over pre-hashed leaves using the given
 * node domain tag. For odd levels, duplicates the last node.
 *
 * Returns 32-byte root. Throws on empty input — Merkle of an empty list is
 * undefined in CE v1.3 (specifications must provide at least one stream).
 */
export function binaryMerkle(leafHashes: readonly Uint8Array[], nodeTag: string): Uint8Array {
  if (leafHashes.length === 0) {
    throw new CanonicalEncodingError("MERKLE_EMPTY", "binary Merkle over empty leaf set is undefined");
  }
  for (const h of leafHashes) {
    if (h.length !== 32) {
      throw new CanonicalEncodingError("MERKLE_BAD_LEAF_LEN", `leaf hash must be 32 bytes, got ${h.length}`);
    }
  }
  let level: Uint8Array[] = leafHashes.slice();
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left; // duplicate last on odd
      next.push(domainHash(nodeTag, concatBytes(left, right)));
    }
    level = next;
  }
  return level[0]!;
}

// ============================================================================
// Stream tree (CE §6.3)
// ============================================================================

export interface StreamLeaf {
  readonly streamId: string;
  readonly stateHash: Uint8Array; // 32 bytes
  readonly lastEventHash: Uint8Array; // 32 bytes
  readonly lastSeqno: bigint | number;
}

export function streamLeafHash(leaf: StreamLeaf): Uint8Array {
  if (leaf.stateHash.length !== 32) {
    throw new CanonicalEncodingError("MERKLE_BAD_STATE_HASH_LEN", `stateHash must be 32 bytes`);
  }
  if (leaf.lastEventHash.length !== 32) {
    throw new CanonicalEncodingError("MERKLE_BAD_EVENT_HASH_LEN", `lastEventHash must be 32 bytes`);
  }
  const idBytes = utf8NfcBytes(leaf.streamId);
  if (idBytes.length > 0xffff) {
    throw new CanonicalEncodingError("MERKLE_STREAM_ID_TOO_LONG", `streamId UTF-8 byte length exceeds uint16`);
  }
  const payload = concatBytes(
    encodeUint16(idBytes.length),
    idBytes,
    leaf.stateHash,
    leaf.lastEventHash,
    encodeUint64(leaf.lastSeqno),
  );
  return domainHash(DOMAIN_TAGS.MERKLE_LEAF_V1, payload);
}

/**
 * Compute the stream-tree Merkle root per CE §6.
 * Leaves are ordered lexicographically by streamId (UTF-8 bytes).
 */
export function streamTreeRoot(leaves: readonly StreamLeaf[]): Uint8Array {
  if (leaves.length === 0) {
    throw new CanonicalEncodingError("MERKLE_EMPTY", "stream tree requires at least one leaf");
  }
  // Order leaves by UTF-8 byte order of streamId (NFC normalized).
  const sorted = leaves.slice().sort((a, b) => {
    const ab = utf8NfcBytes(a.streamId);
    const bb = utf8NfcBytes(b.streamId);
    const len = Math.min(ab.length, bb.length);
    for (let i = 0; i < len; i++) {
      const av = ab[i]!;
      const bv = bb[i]!;
      if (av !== bv) return av - bv;
    }
    return ab.length - bb.length;
  });
  const leafHashes = sorted.map(streamLeafHash);
  return binaryMerkle(leafHashes, DOMAIN_TAGS.MERKLE_NODE_V1);
}

// ============================================================================
// State root (CAL Spec §7.3)
// ============================================================================

export interface StateNamespace {
  /** Namespace name, e.g. "state.cal". */
  readonly name: string;
  /** Canonical bytes of the namespace contents (e.g. from canonicalizeValue). */
  readonly canonicalBytes: Uint8Array;
}

/**
 * Compute the leaf hash for one namespace per CAL Spec §7.3:
 *
 *   leaf = SHA256(STATE_ROOT_V1 ||
 *                 uint16_be(len(name)) || utf8(name) ||
 *                 SHA256(STATE_V1 || canonical_bytes))
 */
export function stateNamespaceLeafHash(ns: StateNamespace): Uint8Array {
  const inner = domainHash(DOMAIN_TAGS.STATE_V1, ns.canonicalBytes);
  const nameBytes = utf8NfcBytes(ns.name);
  if (nameBytes.length > 0xffff) {
    throw new CanonicalEncodingError("STATE_ROOT_NAME_TOO_LONG", `namespace name UTF-8 length exceeds uint16`);
  }
  const payload = concatBytes(encodeUint16(nameBytes.length), nameBytes, inner);
  return domainHash(DOMAIN_TAGS.STATE_ROOT_V1, payload);
}

/**
 * Compute the protocol state root over the given namespaces.
 * Namespaces are ordered lexicographically by name (UTF-8 byte order),
 * matching the CAL Spec §7.3 algorithm.
 */
export function stateRoot(namespaces: readonly StateNamespace[]): Uint8Array {
  if (namespaces.length === 0) {
    throw new CanonicalEncodingError("STATE_ROOT_EMPTY", "state root requires at least one namespace");
  }
  // Detect duplicate names.
  const seen = new Set<string>();
  for (const ns of namespaces) {
    if (seen.has(ns.name)) {
      throw new CanonicalEncodingError("STATE_ROOT_DUPLICATE_NAMESPACE", `duplicate namespace ${JSON.stringify(ns.name)}`);
    }
    seen.add(ns.name);
  }
  const sorted = namespaces.slice().sort((a, b) => {
    const ab = utf8NfcBytes(a.name);
    const bb = utf8NfcBytes(b.name);
    const len = Math.min(ab.length, bb.length);
    for (let i = 0; i < len; i++) {
      const av = ab[i]!;
      const bv = bb[i]!;
      if (av !== bv) return av - bv;
    }
    return ab.length - bb.length;
  });
  const leafHashes = sorted.map(stateNamespaceLeafHash);
  return binaryMerkle(leafHashes, DOMAIN_TAGS.STATE_ROOT_V1);
}
