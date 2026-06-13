tolk 1.4.1

// L2.0 worked example — a minimal counter, to exercise the shared Tolk build harness end-to-end
// (compile → golden codeHash → @ton/sandbox behavior). This is NOT a Layer-2 protocol contract: it holds
// no consensus-projected state, it only proves the harness mechanics (`layer2-toolchain-charter.md` DoD-1).

const OP_INCREMENT = 0x696e6301;   // "inc\x01" — add `by` to the counter
const ERR_UNKNOWN_OP = 0xffff;

// Persistent storage (c4): a single counter.
struct Storage {
    counter: uint64
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
        return;   // plain top-ups (no op) are accepted and ignored
    }
    val op = body.loadUint(32);
    var st = loadStorage();

    if (op == OP_INCREMENT) {
        val by = body.loadUint(64);
        st.counter += by;
        st.save();
        return;
    }

    throw ERR_UNKNOWN_OP;
}

get fun counter(): int {
    return loadStorage().counter;
}
