tolk 1.4.1

// L3.3 — PTRA view (Layer 3 Stage-A, Tier M, above the Freeze Surface).
//
// FRAMING A INVARIANT (layer3-charter.md): OBSERVATIONAL ONLY — "PTRA reflects balances, never mints or
// stakes." It PROJECTS `state.ptra.balances` (the frozen off-chain PTRA state: per-account balance / staked
// / accrued rewards) on-chain. It stores exactly the amounts the off-chain consensus settled — it NEVER
// mints, transfers, stakes, or computes a reward emission (those decisions live in the frozen off-chain
// fold; a real PTRA token + on-chain staking/emission are the deferred Framing-B / PFC-3 economy, or a
// separate Tier-M jetton). This is a balances MIRROR, not the token.

import "@stdlib/tvm-dicts"

const OP_UPSERT_ACCOUNT = 0x50545201;   // "PTR\x01" — owner-only: store one account projection

const ERR_NOT_OWNER = 401;
const ERR_UNKNOWN_OP = 0xffff;
const KEY_BITS = 256;   // account_id (address hash / pubkey) is a uint256

// Persistent storage (c4) — the projection of `state.ptra.balances`:
//   owner:        address
//   accountCount: uint32
//   accounts:     dict<uint256 account_id -> ^PtraRecord>  (record is opaque to this contract)
struct Storage {
    owner: address
    accountCount: uint32
    accounts: dict
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

    if (op == OP_UPSERT_ACCOUNT) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op | account_id:uint256 | ^PtraRecord  (the decided balance/stake rides opaque in a ref;
        // stored verbatim, never minted/computed — the contract reflects a settled balance, it does not stake).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val (_, existed) = st.accounts.uDictGet(KEY_BITS, key);
        st.accounts.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.accountCount += 1;
        }
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// Getters (read-only views; any mint/stake/reward decision is made OFF-chain, never here).
get fun owner(): address {
    return loadStorage().owner;
}

get fun accountCount(): int {
    return loadStorage().accountCount;
}

get fun hasAccount(accountId: int): bool {
    val (_, existed) = loadStorage().accounts.uDictGet(KEY_BITS, accountId);
    return existed;
}

get fun getAccount(accountId: int): cell? {
    return loadStorage().accounts.uDictGetRefOrNull(KEY_BITS, accountId);
}
