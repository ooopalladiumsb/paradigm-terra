package canonical

import (
	"bytes"
	"sort"
	"strconv"
)

// BinaryMerkle computes a binary-balanced Merkle root over pre-hashed leaves
// using the given node domain tag. For an odd level the last node is
// duplicated. Errors on empty input.
func BinaryMerkle(leafHashes [][32]byte, nodeTag string) ([32]byte, error) {
	var zero [32]byte
	if len(leafHashes) == 0 {
		return zero, encodingErr("MERKLE_EMPTY", "binary Merkle over empty leaf set is undefined")
	}
	level := make([][32]byte, len(leafHashes))
	copy(level, leafHashes)
	for len(level) > 1 {
		next := make([][32]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			left := level[i]
			right := left
			if i+1 < len(level) {
				right = level[i+1]
			}
			h, err := DomainHash(nodeTag, ConcatBytes(left[:], right[:]))
			if err != nil {
				return zero, err
			}
			next = append(next, h)
		}
		level = next
	}
	return level[0], nil
}

// StreamLeaf is one stream's leaf input per CE §6.3.
type StreamLeaf struct {
	StreamID      string
	StateHash     [32]byte
	LastEventHash [32]byte
	LastSeqno     uint64
}

// StreamLeafHash computes the CE §6.3 leaf hash for a stream.
func StreamLeafHash(leaf StreamLeaf) ([32]byte, error) {
	var zero [32]byte
	idBytes, err := UTF8NFCBytes(leaf.StreamID)
	if err != nil {
		return zero, err
	}
	if len(idBytes) > 0xffff {
		return zero, encodingErr("MERKLE_STREAM_ID_TOO_LONG", "streamId UTF-8 byte length exceeds uint16")
	}
	idLen := EncodeUint16(uint16(len(idBytes)))
	seqno := EncodeUint64(leaf.LastSeqno)
	payload := ConcatBytes(idLen[:], idBytes, leaf.StateHash[:], leaf.LastEventHash[:], seqno[:])
	return DomainHash(MerkleLeafV1, payload)
}

// StreamTreeRoot computes the stream-tree Merkle root (CE §6). Leaves are
// ordered lexicographically by NFC UTF-8 stream id.
func StreamTreeRoot(leaves []StreamLeaf) ([32]byte, error) {
	var zero [32]byte
	if len(leaves) == 0 {
		return zero, encodingErr("MERKLE_EMPTY", "stream tree requires at least one leaf")
	}
	sorted := make([]StreamLeaf, len(leaves))
	copy(sorted, leaves)
	sort.SliceStable(sorted, func(i, j int) bool {
		return bytes.Compare(nfcBytes(sorted[i].StreamID), nfcBytes(sorted[j].StreamID)) < 0
	})
	leafHashes := make([][32]byte, 0, len(sorted))
	for _, leaf := range sorted {
		h, err := StreamLeafHash(leaf)
		if err != nil {
			return zero, err
		}
		leafHashes = append(leafHashes, h)
	}
	return BinaryMerkle(leafHashes, MerkleNodeV1)
}

// StateNamespace is one namespace's contribution to the state root.
type StateNamespace struct {
	Name           string
	CanonicalBytes []byte
}

// StateNamespaceLeafHash computes the CAL Spec §7.3 leaf hash for a namespace:
//
//	leaf = SHA256(STATE_ROOT_V1 ||
//	              uint16_be(len(name)) || utf8(name) ||
//	              SHA256(STATE_V1 || canonical_bytes))
func StateNamespaceLeafHash(ns StateNamespace) ([32]byte, error) {
	var zero [32]byte
	inner, err := DomainHash(StateV1, ns.CanonicalBytes)
	if err != nil {
		return zero, err
	}
	nameBytes, err := UTF8NFCBytes(ns.Name)
	if err != nil {
		return zero, err
	}
	if len(nameBytes) > 0xffff {
		return zero, encodingErr("STATE_ROOT_NAME_TOO_LONG", "namespace name UTF-8 length exceeds uint16")
	}
	nameLen := EncodeUint16(uint16(len(nameBytes)))
	payload := ConcatBytes(nameLen[:], nameBytes, inner[:])
	return DomainHash(StateRootV1, payload)
}

// StateRoot computes the protocol state root over the given namespaces, ordered
// lexicographically by NFC UTF-8 name (CAL Spec §7.3). Rejects duplicate names.
func StateRoot(namespaces []StateNamespace) ([32]byte, error) {
	var zero [32]byte
	if len(namespaces) == 0 {
		return zero, encodingErr("STATE_ROOT_EMPTY", "state root requires at least one namespace")
	}
	seen := make(map[string]bool, len(namespaces))
	for _, ns := range namespaces {
		if seen[ns.Name] {
			return zero, encodingErr("STATE_ROOT_DUPLICATE_NAMESPACE", "duplicate namespace "+strconv.Quote(ns.Name))
		}
		seen[ns.Name] = true
	}
	sorted := make([]StateNamespace, len(namespaces))
	copy(sorted, namespaces)
	sort.SliceStable(sorted, func(i, j int) bool {
		return bytes.Compare(nfcBytes(sorted[i].Name), nfcBytes(sorted[j].Name)) < 0
	})
	leafHashes := make([][32]byte, 0, len(sorted))
	for _, ns := range sorted {
		h, err := StateNamespaceLeafHash(ns)
		if err != nil {
			return zero, err
		}
		leafHashes = append(leafHashes, h)
	}
	return BinaryMerkle(leafHashes, StateRootV1)
}
