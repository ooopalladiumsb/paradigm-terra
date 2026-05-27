/**
 * Golden-vector verification for the validator. Rebuilds (cal, snapshot, trace)
 * from the stored canonical text, re-runs `validate`, and asserts the emitted
 * event sequence, terminal stage, reason code, economic event fields, and the
 * §9.4 bill all match. The Rust/Go ports must reproduce this. `reason_detail` lives
 * only on the returned result (never an emitted event field — a node hashes events
 * into the CE §6.3 Merkle root), so it is informational and not asserted.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseCanonical } from "@paradigm-terra/canonical";
import { validate, type ExecutionTrace, type Json } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(__dirname, "..", "vectors", "golden.json"), "utf8"));

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTrace(j: any): ExecutionTrace {
  return {
    currentTick: j.current_tick as bigint,
    ownerSigPresent: j.owner_sig_present as boolean,
    stateBefore: j.state_before as Json,
    stateAfter: j.state_after as Json,
    steps: (j.steps as any[]).map((s) => ({
      ok: s.ok as boolean,
      effects: s.effects as Json[],
      errorDetail: s.error_detail as string | undefined,
    })),
  };
}

function num(events: readonly Record<string, Json>[], type: string, key: string): string | null {
  const e = events.find((ev) => ev["event_type"] === type);
  const v = e?.[key];
  return typeof v === "bigint" ? v.toString() : null;
}

test("golden validator vectors reproduce events, economics, and bill", () => {
  assert.ok(golden.vectors.length >= 12);
  for (const v of golden.vectors) {
    const cal = parseCanonical(v.cal_canonical) as Json;
    const snapshot = parseCanonical(v.snapshot_canonical) as Json;
    const trace = toTrace(parseCanonical(v.trace_canonical));
    const res = validate(cal, v.cal_hash, snapshot, trace);
    const o = v.output;

    assert.deepEqual(res.events.map((e) => e["event_type"]), o.event_types, `${v.id}: event_types`);
    assert.equal(res.terminalStage, o.terminal_stage, `${v.id}: terminal_stage`);
    assert.equal(res.reasonCode, o.reason_code, `${v.id}: reason_code`);

    // §9.3 upfront escrow: cal.validated carries escrow_ptra = fee + Max_Expected_Dynamic_Gas.
    assert.equal(num(res.events, "cal.validated", "escrow_ptra"), o.escrow_ptra, `${v.id}: escrow`);
    const terminal = res.events[res.events.length - 1]!;
    const tfd = typeof terminal["fee_debited_ptra"] === "bigint" ? (terminal["fee_debited_ptra"] as bigint).toString() : null;
    assert.equal(tfd, o.terminal_fee_debited_ptra, `${v.id}: terminal_fee_debited`);
    const gc = typeof terminal["gas_consumed_ptra"] === "bigint" ? (terminal["gas_consumed_ptra"] as bigint).toString() : null;
    assert.equal(gc, o.gas_consumed_ptra, `${v.id}: gas_consumed`);
    // The unused-gas refund the terminal event carries (finalized / post-VALIDATED failed / expired-post).
    const gr = typeof terminal["gas_refunded_ptra"] === "bigint" ? (terminal["gas_refunded_ptra"] as bigint).toString() : null;
    assert.equal(gr, o.gas_refunded_ptra, `${v.id}: gas_refunded`);

    assert.equal(res.bill.feeRetained.toString(), o.bill.fee_retained, `${v.id}: bill.feeRetained`);
    assert.equal(res.bill.dynamicGasConsumed.toString(), o.bill.dynamic_gas_consumed, `${v.id}: bill.consumed`);
    assert.equal(res.bill.gasRefunded.toString(), o.bill.gas_refunded, `${v.id}: bill.refunded`);
    assert.equal(res.bill.totalAgentCharge.toString(), o.bill.total_agent_charge, `${v.id}: bill.total`);
  }
});
