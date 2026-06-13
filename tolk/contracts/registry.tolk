tolk 1.4.1

// L2.1 — Registry read-model (Layer 2, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer2-toolchain-charter.md §2.1): this contract is OBSERVATIONAL ONLY. It
// PROJECTS `state.registry` (the frozen off-chain consensus state) on-chain — it does NOT own, decide,
// validate, or derive any of it. The authoritative registry is the off-chain reducer; this contract is a
// mirror the trusted off-chain publisher (the `owner` below) writes, so on-chain parties + the publication
// leg can read/prove agent identity (operator_pubkey, owners, threshold, scopes) and the MCP schema hash
// against an immutable source.
//
// What it does NOT do (Framing A): it never adds/removes an agent on its own authority, never changes
// owners, never computes a threshold, never re-derives consensus. It stores exactly the bytes the
// off-chain reducer produced (the AgentRecord rides as an OPAQUE ref — this contract does not parse it),
// keyed by agent_id. Mirrors the m2-registry reconciliation pattern (the cited prior art).

import "@stdlib/tvm-dicts"

// ── Message ops ──────────────────────────────────────────────────────────────────────────────────
const OP_UPSERT_AGENT = 0x52454701;   // "REG\x01" — owner-only: store/update one agent projection
const OP_SET_MCP_HASH = 0x52454702;   // "REG\x02" — owner-only: update the registry-wide mcp_schema_hash

// ── Exit codes ───────────────────────────────────────────────────────────────────────────────────
const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;

const KEY_BITS = 256;   // agent_id is a uint256

// ── Persistent storage (c4) — the projection of `state.registry` ────────────────────────────────
//   owner:         address   — the only writer (the off-chain publisher/reconciler wallet)
//   mcpSchemaHash: uint256   — projection of state.registry.mcp_schema_hash (0 until first set)
//   agentCount:    uint32    — number of distinct agent_id keys recorded
//   agents:        dict<uint256 agent_id -> ^AgentRecord>   (AgentRecord is opaque to this contract)
struct Storage {
    owner: address
    mcpSchemaHash: uint256
    agentCount: uint32
    agents: dict
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

    if (op == OP_UPSERT_AGENT) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op:uint32 | agent_id:uint256 | ^AgentRecord  (the record rides opaque in a ref; this
        // contract stores it verbatim and never parses it — observational, per Framing A).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val (_, existed) = st.agents.uDictGet(KEY_BITS, key);
        st.agents.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.agentCount += 1;
        }
        st.save();
        return;
    }

    if (op == OP_SET_MCP_HASH) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        st.mcpSchemaHash = body.loadUint(256);
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// ── Getters (read-only views for the publication leg / external observers) ───────────────────────
get fun owner(): address {
    return loadStorage().owner;
}

get fun mcpSchemaHash(): int {
    return loadStorage().mcpSchemaHash;
}

get fun agentCount(): int {
    return loadStorage().agentCount;
}

get fun hasAgent(agentId: int): bool {
    val (_, existed) = loadStorage().agents.uDictGet(KEY_BITS, agentId);
    return existed;
}

// Returns the stored AgentRecord cell, or null if absent. The reader decodes it off-chain.
get fun getAgent(agentId: int): cell? {
    return loadStorage().agents.uDictGetRefOrNull(KEY_BITS, agentId);
}
