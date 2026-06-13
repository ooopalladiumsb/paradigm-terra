tolk 1.4.1

// L2.3 — FailureStateManager view (Layer 2, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer2-toolchain-charter.md §2.1): this contract is OBSERVATIONAL ONLY —
// "FailureState reflects mode, never transitions" / "stores decisions, never makes decisions." It
// PROJECTS `state.failure_mode` (the frozen off-chain failure state: the current mode, is_bounded_mode,
// and a commitment to the capture-guard counters) on-chain. It stores exactly the mode the off-chain
// consensus DECIDED; it NEVER computes a NORMAL→BOUNDED transition, decides an emergency, runs the
// capture guard, or checks a threshold. Every failure-state DECISION stays in the frozen off-chain fold.
// Symmetric to the L2.1 Registry / L2.2 Treasury read-models.

// ── Failure modes (the projected enum; constitution §VI / state.failure_mode). The contract stores the
//    raw value VERBATIM and does NOT validate or interpret it — naming is documentation only. ──────────
const MODE_NORMAL = 0;
const MODE_MCP_DEGRADED = 1;
const MODE_CONSENSUS_UNCERTAINTY = 2;
const MODE_PANIC_HALT = 3;
const MODE_BOUNDED = 4;

// ── Message ops ──────────────────────────────────────────────────────────────────────────────────
const OP_SET_FAILURE_STATE = 0x46535401;   // "FST\x01" — owner-only: store one failure-state projection

// ── Exit codes ───────────────────────────────────────────────────────────────────────────────────
const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;

// ── Persistent storage (c4) — the projection of `state.failure_mode` ────────────────────────────
//   owner:            address   — the only writer (the off-chain publisher/reconciler wallet)
//   version:          uint64    — the projecting tick / state-root tag (0 until first set)
//   mode:             uint8     — projection of the decided failure mode (MODE_*); stored verbatim
//   isBoundedMode:    bool      — projection of state.failure_mode.is_bounded_mode
//   captureGuardHash: uint256   — commitment to state.failure_mode.capture_guard_counters
struct Storage {
    owner: address
    version: uint64
    mode: uint8
    isBoundedMode: bool
    captureGuardHash: uint256
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

    if (op == OP_SET_FAILURE_STATE) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op:uint32 | version:uint64 | mode:uint8 | isBoundedMode:bool | captureGuardHash:uint256
        // stored VERBATIM — the contract performs NO transition logic, threshold check, or inference
        // (e.g. it does NOT derive isBoundedMode from mode). Framing A: it reflects a decided state.
        st.version = body.loadUint(64);
        st.mode = body.loadUint(8);
        st.isBoundedMode = body.loadBool();
        st.captureGuardHash = body.loadUint(256);
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// ── Getters (read-only views for external observers) ─────────────────────────────────────────────
get fun owner(): address {
    return loadStorage().owner;
}

get fun version(): int {
    return loadStorage().version;
}

get fun mode(): int {
    return loadStorage().mode;
}

get fun isBoundedMode(): bool {
    return loadStorage().isBoundedMode;
}

get fun captureGuardHash(): int {
    return loadStorage().captureGuardHash;
}
