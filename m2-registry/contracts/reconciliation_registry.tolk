tolk 1.4.1

// M2-A — Registry reconciliation contract (settlement observation for wallet.send_ton).
//
// NON-NORMATIVE operational DRAFT (Tier M, above the Freeze Surface). This contract OBSERVES and
// RECORDS settlement facts; it decides nothing about consensus (the PR-1 observer discipline). It does
// NOT validate, re-execute, or re-derive any CAL — the off-chain reconciler computes the settlement
// status and the contract merely stores it, keyed by the W5 external-message hash.
//
// SC-1 scope only: structure + reproducible build + record schema. The reconciliation/classification
// logic (settled | missing | delayed | mismatched) lives off-chain and is M2-B (SC-2) — NOT here.

import "@stdlib/tvm-dicts"

// ── Settlement status codes (the reconciliation-record schema; mirrored in src/record.ts) ──────────
// 0 is reserved for "absent / never recorded"; a stored record always carries 1..4.
const STATUS_UNKNOWN = 0;     // not recorded
const STATUS_SETTLED = 1;     // on-chain effect observed == CAL-authorized action
const STATUS_MISSING = 2;     // emitted, but no settling transaction observed within the window
const STATUS_DELAYED = 3;     // settling transaction observed late (outside the expected window)
const STATUS_MISMATCH = 4;    // a settling transaction was observed but its effect != expected

// ── Message ops ────────────────────────────────────────────────────────────────────────────────────
const OP_UPSERT_RECORD = 0x5245_4301;  // "REC\x01" — owner-only: store/update one settlement record

// ── Exit codes ───────────────────────────────────────────────────────────────────────────────────
const ERR_NOT_OWNER = 401;
const ERR_BAD_STATUS = 402;
const ERR_UNKNOWN_OP = 0xffff;

const KEY_BITS = 256;   // external_message_hash is a uint256

// ── Persistent storage (c4) ──────────────────────────────────────────────────────────────────────
//   owner:        address      — the only writer (the off-chain reconciler's wallet)
//   recordCount:  uint32       — number of distinct external_message_hash keys recorded
//   records:      dict<uint256 extMsgHash -> ref Record>
struct Storage {
    owner: address
    recordCount: uint32
    records: dict
}

// ── Reconciliation record (one settlement entry; stored as a ref cell) ───────────────────────────
//   status:             uint8    — one of STATUS_* (1..4)
//   nonce:              uint64   — the CAL nonce (== W5 seqno + 1) this settlement corresponds to
//   calHash:            uint256  — identity of the originating CAL
//   txHash:             uint256  — the observed settling transaction (0 if none yet)
//   observedEffectHash: uint256  — hash of the observed on-chain effect (0 if none yet)
//   updatedAt:          uint32   — unixtime this record was last written
struct Record {
    status: uint8
    nonce: uint64
    calHash: uint256
    txHash: uint256
    observedEffectHash: uint256
    updatedAt: uint32
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

    if (op == OP_UPSERT_RECORD) {
        assert(in.senderAddress == st.owner) throw ERR_NOT_OWNER;
        // body: op:uint32 | key:uint256 | ^Record  (the 872-bit record rides in a ref — it cannot
        // fit inline alongside op+key in a single 1023-bit cell).
        val key = body.loadUint(KEY_BITS);
        val recCell = body.loadRef();
        val rec = Record.fromCell(recCell);
        assert(rec.status >= STATUS_SETTLED && rec.status <= STATUS_MISMATCH) throw ERR_BAD_STATUS;

        val (_, existed) = st.records.uDictGet(KEY_BITS, key);
        st.records.uDictSetRef(KEY_BITS, key, recCell);
        if (!existed) {
            st.recordCount += 1;
        }
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

// ── Getters (read-only views for the off-chain reconciler / observers) ───────────────────────────
get fun owner(): address {
    return loadStorage().owner;
}

get fun recordCount(): int {
    return loadStorage().recordCount;
}

get fun hasRecord(extMsgHash: int): bool {
    val (_, existed) = loadStorage().records.uDictGet(KEY_BITS, extMsgHash);
    return existed;
}

// Returns the stored record cell, or null if absent. The off-chain reconciler decodes it per Record.
get fun getRecord(extMsgHash: int): cell? {
    return loadStorage().records.uDictGetRefOrNull(KEY_BITS, extMsgHash);
}
