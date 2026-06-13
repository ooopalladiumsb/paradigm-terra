tolk 1.4.1

// L3.2 — Oracle view (Layer 3 Stage-A, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer3-charter.md): OBSERVATIONAL ONLY — "Oracle reflects feeds, never aggregates."
// It PROJECTS `state.oracles.feeds` (the frozen off-chain oracle state: the decided feed value per feed_id)
// on-chain. It stores exactly the value the off-chain consensus settled — it NEVER aggregates multiple
// submissions, computes a median, decides a slash, or force-updates (those decisions live in the frozen
// off-chain fold; on-chain feed aggregation + slashing are the deferred Framing-B / PFC-3 economy).

import "@stdlib/tvm-dicts"

const OP_UPSERT_FEED = 0x4f524301;   // "ORC\x01" — owner-only: store one feed projection

const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;
const KEY_BITS = 256;   // feed_id (e.g. a hash of the pair name) is a uint256

// Persistent storage (c4) — the projection of `state.oracles.feeds`:
//   owner:     address
//   feedCount: uint32
//   feeds:     dict<uint256 feed_id -> ^FeedRecord>  (record is opaque to this contract)
struct Storage {
    owner: address
    feedCount: uint32
    feeds: dict
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

    if (op == OP_UPSERT_FEED) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op | feed_id:uint256 | ^FeedRecord  (the decided feed value rides opaque in a ref; stored
        // verbatim, never aggregated/median'd — the contract reflects a settled feed, it does not aggregate).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val (_, existed) = st.feeds.uDictGet(KEY_BITS, key);
        st.feeds.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.feedCount += 1;
        }
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// Getters (read-only views; any aggregation/slashing decision is made OFF-chain, never here).
get fun owner(): address {
    return loadStorage().owner;
}

get fun feedCount(): int {
    return loadStorage().feedCount;
}

get fun hasFeed(feedId: int): bool {
    val (_, existed) = loadStorage().feeds.uDictGet(KEY_BITS, feedId);
    return existed;
}

get fun getFeed(feedId: int): cell? {
    return loadStorage().feeds.uDictGetRefOrNull(KEY_BITS, feedId);
}
