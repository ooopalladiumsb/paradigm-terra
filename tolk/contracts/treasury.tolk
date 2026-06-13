tolk 1.4.1

// L2.2 — Treasury view (Layer 2, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer2-toolchain-charter.md §2.1): this contract is OBSERVATIONAL ONLY —
// "Treasury observes, never settles." It PROJECTS `state.accounting` (the frozen off-chain consensus
// accounting: NAV, developer-fund balance, collected-fees window) on-chain. It stores exactly the values
// the off-chain reducer computed; it NEVER recomputes NAV, distributes fees, executes a settlement, or
// derives any figure. Symmetric to the L2.1 Registry read-model (the off-chain fold stays authoritative;
// the trusted publisher `owner` writes the projection).

// ── Message ops ──────────────────────────────────────────────────────────────────────────────────
const OP_SET_SNAPSHOT = 0x54525301;   // "TRS\x01" — owner-only: store one accounting snapshot

// ── Exit codes ───────────────────────────────────────────────────────────────────────────────────
const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;

// ── Persistent storage (c4) — the projection of `state.accounting` ──────────────────────────────
//   owner:          address   — the only writer (the off-chain publisher/reconciler wallet)
//   version:        uint64    — the projecting tick / state-root tag of the current snapshot (0 until set)
//   nav:            uint256   — projection of state.accounting.nav (stored verbatim, never computed)
//   developerFund:  coins     — projection of state.accounting.developer_fund_balance
//   collectedFees:  coins     — projection of state.accounting.collected_fees_window
struct Storage {
    owner: address
    version: uint64
    nav: uint256
    developerFund: coins
    collectedFees: coins
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

    if (op == OP_SET_SNAPSHOT) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op:uint32 | version:uint64 | nav:uint256 | developerFund:coins | collectedFees:coins
        // every figure is stored VERBATIM — the contract performs no arithmetic on them (Framing A).
        st.version = body.loadUint(64);
        st.nav = body.loadUint(256);
        st.developerFund = body.loadCoins();
        st.collectedFees = body.loadCoins();
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// ── Getters (read-only views for external observers / settlement reconciliation) ─────────────────
get fun owner(): address {
    return loadStorage().owner;
}

get fun version(): int {
    return loadStorage().version;
}

get fun nav(): int {
    return loadStorage().nav;
}

get fun developerFund(): int {
    return loadStorage().developerFund;
}

get fun collectedFees(): int {
    return loadStorage().collectedFees;
}
