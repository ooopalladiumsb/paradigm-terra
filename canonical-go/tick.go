package canonical

// StateTick is the `state.tick` namespace from the v0.10.0-draft State Layout
// (Constitution §XVII / CAL Spec §7).
//
// IMPORTANT — encoding scheme. The canonical form of a state namespace is its
// restricted-JCS serialization (CE v1.3 §4), NOT a Borsh/little-endian blob,
// and the Merkle leaf uses the two-level domain-separated hash from CAL Spec
// §7.3 (STATE_ROOT_V1 over an inner STATE_V1 hash), with a big-endian uint16
// name-length prefix and ASCII domain tags that contain no NUL bytes. This
// reproduces the TypeScript and Rust references byte-for-byte and the NORMATIVE
// golden vectors. (A Borsh/LE scheme with a STATE_LEAF tag would be a different
// protocol and would fail parity.)

// TickNamespace is the canonical namespace name used in the state root.
const TickNamespace = "state.tick"

// StateTick mirrors the state.tick structure from the DSL/State spec.
type StateTick struct {
	Current       uint64
	Genesis       uint64
	BlocksPerTick uint32
	Epoch         uint64
}

// CanonicalBytes returns the restricted-JCS canonical bytes for this namespace:
//
//	{"blocks_per_tick":N,"current":N,"epoch":N,"genesis":N}
//
// (keys sorted by UTF-8 byte order; integers only). The genesis value
// StateTick{0,0,12,0} yields exactly the bytes fed to the NORMATIVE
// state_root_genesis_empty golden vector.
func (t StateTick) CanonicalBytes() ([]byte, error) {
	return CanonicalizeValue(O(
		P("current", IntU(t.Current)),
		P("genesis", IntU(t.Genesis)),
		P("blocks_per_tick", IntU(uint64(t.BlocksPerTick))),
		P("epoch", IntU(t.Epoch)),
	))
}

// LeafHash returns the state-root Merkle leaf hash for the state.tick namespace
// per CAL Spec §7.3:
//
//	SHA256(STATE_ROOT_V1 ||
//	       uint16_be(len("state.tick")) || "state.tick" ||
//	       SHA256(STATE_V1 || CanonicalBytes()))
func (t StateTick) LeafHash() ([32]byte, error) {
	cb, err := t.CanonicalBytes()
	if err != nil {
		return [32]byte{}, err
	}
	return StateNamespaceLeafHash(StateNamespace{Name: TickNamespace, CanonicalBytes: cb})
}
