tolk 1.4.1

// L3.1 — Governance view (Layer 3 Stage-A, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer2-toolchain-charter.md §2.1 / layer3-charter.md): OBSERVATIONAL ONLY —
// "Governance reflects tallies, never votes." It PROJECTS `state.governance` (the frozen off-chain
// governance state: per-proposal tallies/status + the chain-wide params) on-chain. It stores exactly the
// outcome the off-chain consensus DECIDED — it NEVER tallies a vote, decides a proposal's status, applies
// quorum/threshold, or executes a timelock (those decisions live in the frozen off-chain fold; on-chain
// voting is the deferred Framing-B / PFC-3 economy). Symmetric to the Layer-2 read-models.

import "@stdlib/tvm-dicts"

const OP_UPSERT_PROPOSAL = 0x47565001;   // "GVP\x01" — owner-only: store one proposal projection
const OP_SET_PARAMS      = 0x47565002;   // "GVP\x02" — owner-only: store the chain-wide gov params

const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;
const KEY_BITS = 64;   // proposal_id is a uint64

// Persistent storage (c4) — the projection of `state.governance`:
//   owner:                    address
//   gasPriceNanoPtraPerUnit:  uint64   — projection of state.governance.gas_price_nano_ptra_per_unit
//   proposalCount:            uint32
//   proposals:                dict<uint64 proposal_id -> ^ProposalRecord>  (record is opaque to this contract)
struct Storage {
    owner: address
    gasPriceNanoPtraPerUnit: uint64
    proposalCount: uint32
    proposals: dict
}

fun loadStorage(): Storage {
    return Storage.fromCell(contract.getData());
}

fun Storage.save(self) {
    contract.setData(self.toCell());
}

fun onInternalMessage(in: InMessage) {
    var body = in.body;
    if (body.remainingBitsCount() < 32) {
        return;
    }
    val op = body.loadUint(32);
    var st = loadStorage();

    if (op == OP_UPSERT_PROPOSAL) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op | proposal_id:uint64 | ^ProposalRecord  (the tally/status record rides opaque in a ref;
        // stored verbatim, never parsed/recomputed — the contract reflects a decided tally, it does not vote).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val (_, existed) = st.proposals.uDictGet(KEY_BITS, key);
        st.proposals.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.proposalCount += 1;
        }
        st.save();
        return;
    }

    if (op == OP_SET_PARAMS) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        st.gasPriceNanoPtraPerUnit = body.loadUint(64);
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// Getters (read-only views; any governance decision is made OFF-chain, never here).
get fun owner(): address {
    return loadStorage().owner;
}

get fun gasPriceNanoPtraPerUnit(): int {
    return loadStorage().gasPriceNanoPtraPerUnit;
}

get fun proposalCount(): int {
    return loadStorage().proposalCount;
}

get fun hasProposal(proposalId: int): bool {
    val (_, existed) = loadStorage().proposals.uDictGet(KEY_BITS, proposalId);
    return existed;
}

get fun getProposal(proposalId: int): cell? {
    return loadStorage().proposals.uDictGetRefOrNull(KEY_BITS, proposalId);
}
