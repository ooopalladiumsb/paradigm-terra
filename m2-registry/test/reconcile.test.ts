// M2-B · SC-2 — the reconciler detects all four settlement classes (offline, simulated observations).
// Also proves the integration boundary: a classified status feeds the M2-A record schema unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, type ExpectedSettlement, type ObservedSettlement } from "../src/reconcile.ts";
import { SettlementStatus, buildRecordCell, parseRecordCell, type ReconciliationRecord } from "../src/record.ts";

const DEST = 0xca2f3bn;
const VALUE = 50_000_000n;
const DEADLINE = 1_749_000_120; // emit + 120s window (the PP#2 valid_until horizon)

const expected: ExpectedSettlement = {
  externalMessageHash: 0xa8d5863an,
  calHash: 0x8d4b96e6n,
  nonce: 1n,
  dest: DEST,
  value: VALUE,
  deadlineUnix: DEADLINE,
};

const faithful = (observedAtUnix: number): ObservedSettlement => ({
  txHash: 0xdeadbeefn,
  effectDest: DEST,
  effectValue: VALUE,
  observedAtUnix,
});

test("SC-2 · SETTLED: faithful effect within the window", () => {
  const r = classify(expected, faithful(DEADLINE - 10), DEADLINE);
  assert.equal(r.status, SettlementStatus.Settled);
  assert.equal(r.terminal, true);
});

test("SC-2 · MISSING: no settling tx observed past the deadline", () => {
  const r = classify(expected, null, DEADLINE + 1);
  assert.equal(r.status, SettlementStatus.Missing);
  assert.equal(r.terminal, true);
});

test("SC-2 · DELAYED: faithful effect, but observed after the deadline", () => {
  const r = classify(expected, faithful(DEADLINE + 30), DEADLINE + 30);
  assert.equal(r.status, SettlementStatus.Delayed);
  assert.equal(r.terminal, true);
});

test("SC-2 · MISMATCH: wrong destination", () => {
  const r = classify(expected, { ...faithful(DEADLINE - 10), effectDest: 0xbadn }, DEADLINE);
  assert.equal(r.status, SettlementStatus.Mismatch);
  assert.match(r.reason, /destination/);
});

test("SC-2 · MISMATCH: value widened (⊆ violation, the worst case)", () => {
  const r = classify(expected, { ...faithful(DEADLINE - 10), effectValue: VALUE + 1n }, DEADLINE);
  assert.equal(r.status, SettlementStatus.Mismatch);
  assert.match(r.reason, /widened/);
});

test("SC-2 · MISMATCH: value shortened", () => {
  const r = classify(expected, { ...faithful(DEADLINE - 10), effectValue: VALUE - 1n }, DEADLINE);
  assert.equal(r.status, SettlementStatus.Mismatch);
  assert.match(r.reason, /shortened/);
});

test("SC-2 · MISMATCH dominates timing: wrong effect observed late is still MISMATCH, not DELAYED", () => {
  const r = classify(expected, { ...faithful(DEADLINE + 99), effectDest: 0xbadn }, DEADLINE + 99);
  assert.equal(r.status, SettlementStatus.Mismatch);
});

test("SC-2 · UNKNOWN: not yet observed while the window is still open (non-terminal)", () => {
  const r = classify(expected, null, DEADLINE - 5);
  assert.equal(r.status, SettlementStatus.Unknown);
  assert.equal(r.terminal, false);
});

test("SC-2 → M2-A integration: a classified status feeds the record schema unchanged", () => {
  const r = classify(expected, faithful(DEADLINE - 1), DEADLINE);
  const rec: ReconciliationRecord = {
    status: r.status,
    nonce: expected.nonce,
    calHash: expected.calHash,
    txHash: 0xdeadbeefn,
    observedEffectHash: 0n,
    updatedAt: DEADLINE,
  };
  assert.equal(parseRecordCell(buildRecordCell(rec)).status, SettlementStatus.Settled);
});
