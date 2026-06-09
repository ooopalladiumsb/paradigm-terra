/**
 * End-to-end round-trip: the CAL validator's emitted events, fed straight into
 * the frozen reducer, must move exactly the PTRA the validator's §9.4 `bill`
 * intends. This is the integration check that originally exposed the §9.4 gap
 * (pre-VALIDATED failures billed a fee the reducer never moved); after the
 * Tier-2 revision it holds for every pre-VALIDATED outcome and the happy path.
 *
 * It imports BOTH packages by source (the validator deliberately has no reducer
 * dependency, so the round-trip lives here, at the consumer): the validator from
 * ../../validator, the reducer from ../src.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { materialize, getIn, type Json, type State } from "../src/index.js";
import { validate, type ExecutionTrace } from "../../validator/src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const SIG = "0x" + "ab".repeat(64);
const CH = "0x" + "11".repeat(32);
const EFFECT: Json = { ns: "ptra", op: "set", path: ["counters", "x"], value: 1n };

type Obj = Record<string, Json>;

function calSend(extra: Obj = {}): Obj {
  return {
    cal_version: "0.1.0",
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 100000000n } },
    invariants: [{ op: "eq", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } }],
    steps: [{ verb: "wallet.send_ton", params: { to: A, amount_nano_ton: 50n }, post_conditions: [{ op: "lt", lhs: { var: "state.after.x" }, rhs: { var: "state.before.x" } }] }],
    receipt_required: true,
    signatures: { operator_sig: SIG },
    ...extra,
  };
}

function snap(opts: { balance?: bigint; nonce?: bigint; scopes?: string[] } = {}): Obj {
  const { balance = 10n ** 18n, nonce = 0n, scopes = ["ton_transfer"] } = opts;
  return {
    cal: { in_flight: {}, nonces: { [A]: nonce } },
    failure_mode: { is_bounded_mode: false, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: 1000n, genesis_validator_set: [], params: {} },
    oracles: { feeds: {} },
    ptra: { balances: { [A]: balance } },
    registry: { agents: { [A]: { granted_scopes: scopes, operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) } }, mcp_schema_hash: "0x" + "00".repeat(32) },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

const HAPPY_BEFORE: Json = { x: 5n, treasury: { nav: 0n } };
const HAPPY_AFTER: Json = { x: 1n, treasury: { nav: 0n } };

function trace(opts: { steps?: ExecutionTrace["steps"]; before?: Json; after?: Json; owner?: boolean } = {}): ExecutionTrace {
  return {
    currentTick: 0n,
    steps: opts.steps ?? [{ ok: true, effects: [EFFECT] }],
    stateBefore: opts.before ?? HAPPY_BEFORE,
    stateAfter: opts.after ?? HAPPY_AFTER,
    operatorSigPresent: true,
    ownerSigPresent: opts.owner ?? false,
  };
}

/** Reducer start state = the validator's snapshot with the CAL already in-flight at SIGNED
 *  (cal.created/cal.signed are TON-ingress events the validator does not emit, §9.1). */
function startState(snapshot: Obj): State {
  const s = structuredClone(snapshot) as Obj;
  (((s.cal as Obj).in_flight) as Obj)[CH] = { agent_id: A, stage: "SIGNED", escrowed_ptra: 0n, gas_consumed_ptra: 0n, staged: [] };
  return s as unknown as State;
}

function bal(s: State): bigint {
  const v = getIn(s, ["ptra", "balances", A]);
  return typeof v === "bigint" ? v : 0n;
}
function fees(s: State): bigint {
  const v = getIn(s, ["treasury", "collected_fees_window"]);
  return typeof v === "bigint" ? v : 0n;
}

/** Run validate → materialize(events) and return the economic deltas + the bill. */
function roundtrip(cal: Obj, snapshot: Obj, tr: ExecutionTrace) {
  const res = validate(cal as Json, CH, snapshot as Json, tr);
  const start = startState(snapshot);
  const applied = materialize(res.events as Json[], start);
  assert.equal(applied.ok, true, `reducer rejected the validator's event log: ${applied.ok ? "" : applied.code}`);
  if (!applied.ok) throw new Error("unreachable");
  return {
    res,
    balCharged: bal(start) - bal(applied.state), // PTRA removed from the agent
    feesGained: fees(applied.state) - fees(start), // PTRA retained by the treasury
    bill: res.bill,
  };
}

test("round-trip: happy path FINALIZED — agent net charge = treasury gain = fee + consumed gas", () => {
  const r = roundtrip(calSend(), snap(), trace());
  assert.equal(r.res.terminalStage, "FINALIZED");
  // §9.3 escrow conserves: the agent escrows fee + maxGas at cal.validated and is
  // refunded the unused gas at cal.finalized. Net debit (escrow − refund) = treasury
  // gain (escrow − refund) = fee + consumed gas = bill.totalAgentCharge. The staged
  // effect in this scenario touches ptra.counters.x, not the agent's balance.
  assert.equal(r.bill.totalAgentCharge, r.bill.feeRetained + r.bill.dynamicGasConsumed);
  assert.equal(r.feesGained, r.bill.totalAgentCharge);
  assert.equal(r.balCharged, r.bill.totalAgentCharge);
});

test("round-trip: PRECOND_FALSE (pre-VALIDATED, partial) — agent and treasury both move bill.feeRetained", () => {
  // balance 50 < precond threshold AND < flat fee → spam charge capped at 50.
  const r = roundtrip(calSend(), snap({ balance: 50n }), trace());
  assert.equal(r.res.reasonCode, "PRECOND_FALSE");
  assert.equal(r.bill.feeRetained, 50n); // min(fee, balance)
  // THE FIX: before the Tier-2 revision both deltas were 0 while the bill said 50.
  assert.equal(r.balCharged, r.bill.feeRetained);
  assert.equal(r.feesGained, r.bill.feeRetained);
  assert.equal(r.balCharged, r.bill.totalAgentCharge);
});

test("round-trip: CAPABILITY_DENIED (pre-VALIDATED, full fee) conserves", () => {
  const r = roundtrip(calSend(), snap({ scopes: [] }), trace());
  assert.equal(r.res.reasonCode, "CAPABILITY_DENIED");
  assert.equal(r.bill.feeRetained, 100000n); // full flat fee (ample balance)
  assert.equal(r.balCharged, 100000n);
  assert.equal(r.feesGained, 100000n);
});

test("round-trip: NONCE_MISMATCH (no-charge) moves no PTRA", () => {
  const r = roundtrip(calSend(), snap({ nonce: 5n }), trace());
  assert.equal(r.res.reasonCode, "NONCE_MISMATCH");
  assert.equal(r.balCharged, 0n);
  assert.equal(r.feesGained, 0n);
  assert.deepEqual(
    [r.bill.feeRetained, r.bill.dynamicGasConsumed, r.bill.gasRefunded, r.bill.totalAgentCharge],
    [0n, 0n, 0n, 0n],
  );
});

test("round-trip: INVARIANT_FALSE (post-VALIDATED) — agent and treasury both move fee + consumed gas", () => {
  // invariant over before/after is violated after cal.executed fired (staged, then dropped).
  const r = roundtrip(calSend(), snap(), trace({ before: { x: 5n, treasury: { nav: 0n } }, after: { x: 1n, treasury: { nav: 10n } } }));
  assert.equal(r.res.reasonCode, "INVARIANT_FALSE");
  assert.equal(r.feesGained, r.bill.feeRetained + r.bill.dynamicGasConsumed); // post-VALIDATED conserves
  assert.equal(r.balCharged, r.bill.totalAgentCharge); // escrow − refund = fee + consumed
});

test("round-trip: STEP_ERROR (post-VALIDATED, before cal.executed) — consumed gas reaches the treasury (§6.2 closed)", () => {
  // STEP_ERROR fails at gate 9, before cal.executed. Under §9.3 the agent escrowed
  // fee + maxGas at cal.validated; the failure event refunds the unused gas, so the
  // treasury keeps fee + consumed exactly as the FAILED_EXEC bill intends — and the
  // agent's net debit equals it. Closes the §6.2 residue structurally.
  const r = roundtrip(calSend(), snap(), trace({ steps: [{ ok: false, effects: [], errorDetail: "reverted" }] }));
  assert.equal(r.res.reasonCode, "STEP_ERROR");
  assert.ok(r.bill.dynamicGasConsumed > 0n, "bill intends to retain consumed gas");
  assert.equal(r.feesGained, r.bill.feeRetained + r.bill.dynamicGasConsumed); // fee + consumed gas retained
  assert.equal(r.balCharged, r.bill.totalAgentCharge); // agent net debit = escrow − refund = fee + consumed
});
