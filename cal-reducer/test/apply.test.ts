/**
 * Reducer semantics: staging commit vs discard, balances, nonces, bounded mode.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, genesis, getIn, materialize, type Json, type State } from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const CH = `0x${"11".repeat(32)}`;
const CH2 = `0x${"22".repeat(32)}`;

function funded(amount: bigint): State {
  const g = genesis();
  (g.ptra as { balances: Record<string, Json> }).balances[A] = amount;
  return g;
}

// §9.3 escrow: cal.validated debits the full escrow (fee + Max_Expected_Dynamic_Gas);
// the terminal event refunds the unused gas, so the treasury keeps escrow − refund.
const lifecycle = (ch: string, escrow: bigint, gas: bigint, navDelta: bigint): { [k: string]: Json }[] => [
  { event_type: "cal.created", cal_hash: ch, agent_id: A },
  { event_type: "cal.signed", cal_hash: ch },
  { event_type: "cal.validated", cal_hash: ch, escrow_ptra: escrow },
  { event_type: "cal.executed", cal_hash: ch, gas_consumed_ptra: gas, effects: [{ ns: "treasury", op: "add", path: ["nav"], value: navDelta }] },
  { event_type: "cal.settled", cal_hash: ch },
];

test("finalize commits staged effects; balances, fees, nonce update", () => {
  // escrow 350k (fee 100k + maxGas 250k); consumed 200k → refund 50k; treasury keeps 300k.
  const events = [...lifecycle(CH, 350_000n, 200_000n, 1_000n), { event_type: "cal.finalized", cal_hash: CH, gas_refunded_ptra: 50_000n }];
  const r = materialize(events, funded(1_000_000n));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(getIn(r.state, ["treasury", "nav"]), 1_000n); // staged delta committed
  assert.equal(getIn(r.state, ["ptra", "balances", A]), 700_000n); // -350k escrow +50k refund
  assert.equal(getIn(r.state, ["treasury", "collected_fees_window"]), 300_000n); // escrow-refund = fee+consumed
  assert.equal(getIn(r.state, ["cal", "nonces", A]), 1n);
  assert.equal(getIn(r.state, ["cal", "in_flight", CH]), undefined);
});

test("failure discards staged effects but still burns nonce + retains fees", () => {
  // escrow 350k; consumed 50k → refund 200k; treasury keeps 150k (= fee 100k + consumed 50k).
  const events = [...lifecycle(CH, 350_000n, 50_000n, 9_999n), { event_type: "cal.failed", cal_hash: CH, gas_refunded_ptra: 200_000n }];
  const r = materialize(events, funded(1_000_000n));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(getIn(r.state, ["treasury", "nav"]), 0n); // staged delta dropped
  assert.equal(getIn(r.state, ["ptra", "balances", A]), 850_000n); // -350k escrow +200k refund
  assert.equal(getIn(r.state, ["treasury", "collected_fees_window"]), 150_000n); // escrow-refund = fee+consumed
  assert.equal(getIn(r.state, ["cal", "nonces", A]), 1n);
});

test("§9.4 Tier-2: pre-VALIDATED failure debits the carried spam fee (full)", () => {
  // SIGNED→FAILED (PRECOND_FALSE): no cal.validated, so the fee was never escrowed;
  // the failed event carries it and the reducer debits it now + retains it.
  const events = [
    { event_type: "cal.created", cal_hash: CH, agent_id: A },
    { event_type: "cal.signed", cal_hash: CH },
    { event_type: "cal.failed", cal_hash: CH, reason_code: "PRECOND_FALSE", fee_debited_ptra: 100_000n },
  ];
  const r = materialize(events, funded(1_000_000n));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(getIn(r.state, ["ptra", "balances", A]), 900_000n); // spam fee debited
  assert.equal(getIn(r.state, ["treasury", "collected_fees_window"]), 100_000n); // retained
  assert.equal(getIn(r.state, ["cal", "nonces", A]), 1n);
  assert.equal(getIn(r.state, ["cal", "in_flight", CH]), undefined);
});

test("§9.4 Tier-2: pre-VALIDATED spam charge is capped at the balance (min(fee, balance))", () => {
  // The validator baked min(fee, balance) into the event; the reducer debits exactly
  // that and never underflows.
  const events = [
    { event_type: "cal.created", cal_hash: CH, agent_id: A },
    { event_type: "cal.signed", cal_hash: CH },
    { event_type: "cal.failed", cal_hash: CH, reason_code: "CAPABILITY_DENIED", fee_debited_ptra: 30_000n },
  ];
  const r = materialize(events, funded(30_000n));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(getIn(r.state, ["ptra", "balances", A]), 0n);
  assert.equal(getIn(r.state, ["treasury", "collected_fees_window"]), 30_000n);
});

test("§9.4 Tier-2: a no-charge pre-VALIDATED failure (fee=0) moves no PTRA", () => {
  const events = [
    { event_type: "cal.created", cal_hash: CH, agent_id: A },
    { event_type: "cal.signed", cal_hash: CH },
    { event_type: "cal.failed", cal_hash: CH, reason_code: "NONCE_MISMATCH", fee_debited_ptra: 0n },
  ];
  const r = materialize(events, funded(1_000_000n));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(getIn(r.state, ["ptra", "balances", A]), 1_000_000n); // untouched
  assert.equal(getIn(r.state, ["treasury", "collected_fees_window"]), 0n);
  assert.equal(getIn(r.state, ["cal", "nonces", A]), 1n); // nonce still burns
});

test("per-agent serialization: second create while in-flight → AGENT_BUSY", () => {
  const r = materialize(
    [
      { event_type: "cal.created", cal_hash: CH, agent_id: A },
      { event_type: "cal.created", cal_hash: CH2, agent_id: A },
    ],
    genesis(),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "AGENT_BUSY");
});

test("tick.advanced flips bounded mode via capture-guard counter", () => {
  const g = genesis();
  (g.governance as { params: Record<string, Json> }).params.capture_guard_threshold = 2n;
  (g.failure_mode as { capture_guard_counters: Record<string, Json> }).capture_guard_counters.c = 2n;
  const r = apply(g, { event_type: "tick.advanced", new_tick: 1n });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(getIn(r.state, ["failure_mode", "is_bounded_mode"]), true);
});

test("apply is total — no throw on a malformed event", () => {
  const r = apply(genesis(), { event_type: "nope" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "UNKNOWN_EVENT");
});
