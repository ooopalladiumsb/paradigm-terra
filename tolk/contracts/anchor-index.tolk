tolk 1.4.1

// L2.5 — Anchor index (Layer 2, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer2-toolchain-charter.md §2.1): this contract is OBSERVATIONAL ONLY —
// "Anchor index indexes facts, never verifies consensus." It records the link between a projected state
// version and the on-chain anchor that committed its STATE_ROOT (the PP#2 / PP#4-B anchor pattern): per
// version, the anchored state_root, the publishing tx hash, and its lt. It stores exactly what the
// off-chain observer recorded; it NEVER re-derives a STATE_ROOT, validates the anchor tx, checks a proof,
// or decides anything about consensus (re-derivation/verification is off-chain). The index turns scattered
// on-chain anchor facts into a queryable map; it does not bless them. Symmetric to the other read-models.

import "@stdlib/tvm-dicts"

// ── Message ops ──────────────────────────────────────────────────────────────────────────────────
const OP_RECORD_ANCHOR = 0x414e4301;   // "ANC\x01" — owner-only: store/update one anchor fact (by version)

// ── Exit codes ───────────────────────────────────────────────────────────────────────────────────
const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;

const KEY_BITS = 64;   // version (tick / state-root sequence tag) is a uint64

// ── Persistent storage (c4) — the index of published anchors ────────────────────────────────────
//   owner:        address   — the only writer (the off-chain publisher/observer wallet)
//   latestVersion: uint64   — the highest version recorded (0 until first record)
//   anchorCount:  uint32    — number of distinct version keys recorded
//   anchors:      dict<uint64 version -> ^AnchorRecord>  (record is opaque to this contract)
struct Storage {
    owner: address
    latestVersion: uint64
    anchorCount: uint32
    anchors: dict
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

    if (op == OP_RECORD_ANCHOR) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op:uint32 | version:uint64 | ^AnchorRecord  (the anchor fact rides opaque in a ref; this
        // contract stores it verbatim and never parses/verifies it — it indexes, it does not bless).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val (_, existed) = st.anchors.uDictGet(KEY_BITS, key);
        st.anchors.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.anchorCount += 1;
        }
        if (key > st.latestVersion) {
            st.latestVersion = key;
        }
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// ── Getters (read-only views; verification of any anchor is done OFF-chain, never here) ──────────
get fun owner(): address {
    return loadStorage().owner;
}

get fun latestVersion(): int {
    return loadStorage().latestVersion;
}

get fun anchorCount(): int {
    return loadStorage().anchorCount;
}

get fun hasAnchor(version: int): bool {
    val (_, existed) = loadStorage().anchors.uDictGet(KEY_BITS, version);
    return existed;
}

// Returns the stored AnchorRecord cell, or null if absent. The reader decodes + re-derives/verifies the
// STATE_ROOT off-chain; this getter asserts nothing about consensus.
get fun getAnchor(version: int): cell? {
    return loadStorage().anchors.uDictGetRefOrNull(KEY_BITS, version);
}
