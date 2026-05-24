package canonical

// Domain tags from CE v1.3 §7.1 and the v0.10.0-draft additions. Each is an
// ASCII literal prefixed to the canonical byte sequence before SHA-256.
// Adding or modifying a tag requires a Tier 2 amendment.
const (
	// CE v1.3 §7.1
	DSLV11       = "PARADIGM_TERRA_DSL_V1.1"
	MerkleLeafV1 = "PARADIGM_TERRA_MERKLE_LEAF_V1"
	MerkleNodeV1 = "PARADIGM_TERRA_MERKLE_NODE_V1"
	StateV1      = "PARADIGM_TERRA_STATE_V1"
	EventV1      = "PARADIGM_TERRA_EVENT_V1"
	EventChainV1 = "PARADIGM_TERRA_EVENTCHAIN_V1"
	ReceiptV1    = "PARADIGM_TERRA_RECEIPT_V1"
	CALV1        = "PARADIGM_TERRA_CAL_V1"
	AddressV1    = "PARADIGM_TERRA_ADDRESS_V1"
	// CE v1.3 §3.5 — PTRA jetton
	JettonTransferV1 = "PARADIGM_TERRA_JETTON_TRANSFER_V1"
	PTRAStakeV1      = "PARADIGM_TERRA_PTRA_STAKE_V1"
	PTRAUnstakeV1    = "PARADIGM_TERRA_PTRA_UNSTAKE_V1"
	PTRABurnV1       = "PARADIGM_TERRA_PTRA_BURN_V1"
	// CE v1.3 §VI MCP schema
	MCPV1 = "PARADIGM_TERRA_MCP_V1"
	// v0.10.0-draft additions (CAL Spec §7.3, DSL Spec §8.1)
	StateRootV1 = "PARADIGM_TERRA_STATE_ROOT_V1"
	DSLV12      = "PARADIGM_TERRA_DSL_V1.2"
)

// DomainTag pairs a registry name (matching the domain_tags_registry golden
// vector keys) with its ASCII value.
type DomainTag struct {
	Name  string
	Value string
}

// AllDomainTags lists every registered tag in registry order.
var AllDomainTags = []DomainTag{
	{"DSL_V1_1", DSLV11},
	{"MERKLE_LEAF_V1", MerkleLeafV1},
	{"MERKLE_NODE_V1", MerkleNodeV1},
	{"STATE_V1", StateV1},
	{"EVENT_V1", EventV1},
	{"EVENTCHAIN_V1", EventChainV1},
	{"RECEIPT_V1", ReceiptV1},
	{"CAL_V1", CALV1},
	{"ADDRESS_V1", AddressV1},
	{"JETTON_TRANSFER_V1", JettonTransferV1},
	{"PTRA_STAKE_V1", PTRAStakeV1},
	{"PTRA_UNSTAKE_V1", PTRAUnstakeV1},
	{"PTRA_BURN_V1", PTRABurnV1},
	{"MCP_V1", MCPV1},
	{"STATE_ROOT_V1", StateRootV1},
	{"DSL_V1_2", DSLV12},
}

// IsASCIIDomainTag reports whether tag is non-empty, has no NUL, and is ASCII.
func IsASCIIDomainTag(tag string) bool {
	if len(tag) == 0 {
		return false
	}
	for i := 0; i < len(tag); i++ {
		if tag[i] == 0 || tag[i] > 0x7f {
			return false
		}
	}
	return true
}
