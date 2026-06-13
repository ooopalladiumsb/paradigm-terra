tolk 1.4.1

// L2.4 — Capability view (Layer 2, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer2-toolchain-charter.md §2.1): this contract is OBSERVATIONAL ONLY —
// "Capability reflects grants, never authorizes." It PROJECTS the per-agent capability state
// (`state.registry.agents[a].granted_scopes` + the capability profile) on-chain. It stores exactly the
// grants the off-chain consensus DECIDED; it NEVER decides access, computes a permission, checks a scope
// against an action (the §4.3 REQUIRES_SCOPE_TABLE check is the off-chain validator's job), or
// participates in consensus. A dumb mirror — symmetric to the L2.1 Registry read-model.

import "@stdlib/tvm-dicts"

// ── Message ops ──────────────────────────────────────────────────────────────────────────────────
const OP_UPSERT_CAPABILITY = 0x43415001;   // "CAP\x01" — owner-only: store/update one agent capability projection

// ── Exit codes ───────────────────────────────────────────────────────────────────────────────────
const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;

const KEY_BITS = 256;   // agent_id is a uint256

// ── Persistent storage (c4) — the projection of per-agent capability state ──────────────────────
//   owner:        address   — the only writer (the off-chain publisher/reconciler wallet)
//   agentCount:   uint32    — number of distinct agent_id keys recorded
//   capabilities: dict<uint256 agent_id -> ^CapabilityRecord>  (record is opaque to this contract)
struct Storage {
    owner: address
    agentCount: uint32
    capabilities: dict
}

fun loadStorage(): Storage {
    return Storage.fromCell(contract.getData());
}

fun Storage.save(self) {
    contract.setData(self.toCell());
}

fun onInternalMessage(in: InMessage) {
    var body = in.body;
    // empty-bodied messages (plain top-ups) are accepted and ignored.
    if (body.remainingBitsCount() < 32) {
        return;
    }
    val op = body.loadUint(32);
    var st = loadStorage();

    if (op == OP_UPSERT_CAPABILITY) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op:uint32 | agent_id:uint256 | ^CapabilityRecord  (the grant record rides opaque in a ref;
        // this contract stores it verbatim and never parses it — it grants nothing, it reflects grants).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val (_, existed) = st.capabilities.uDictGet(KEY_BITS, key);
        st.capabilities.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.agentCount += 1;
        }
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// ── Getters (read-only views; the reader makes any access decision OFF-chain, never this contract) ──
get fun owner(): address {
    return loadStorage().owner;
}

get fun agentCount(): int {
    return loadStorage().agentCount;
}

get fun hasCapability(agentId: int): bool {
    val (_, existed) = loadStorage().capabilities.uDictGet(KEY_BITS, agentId);
    return existed;
}

// Returns the stored CapabilityRecord cell, or null if absent. The reader decodes the granted scopes
// off-chain; this getter authorizes nothing.
get fun getCapability(agentId: int): cell? {
    return loadStorage().capabilities.uDictGetRefOrNull(KEY_BITS, agentId);
}
