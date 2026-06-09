/**
 * PR-1.6 — alerting. DoD: each rule FIRES at its threshold and RESOLVES on return; firing is
 * deduplicated (no spam while a condition holds); a severity change while firing emits a fresh event;
 * nothing fires when all is well; rules are orthogonal (one signal each, no cross-firing). Alerts are
 * observers — the manager's only state is alert lifecycle.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { NodeObservation } from "../src/node/persistent-node.js";
import type { MetricsReport } from "../src/node/metrics.js";
import type { DriftResult } from "../src/node/monitoring.js";
import { AlertManager } from "../src/node/alerting.js";
import { RECOVERY_SLA_MS } from "../src/node/recovery-sla.js";

const stat = (max = 0) => ({ last: max, avg: max, max, n: 1 });
const baseObs: NodeObservation = { stateRoot: "0x0", globalRoot: "0x0", eventCount: 0, lastEventHash: "0x0", currentTick: 0n, recoveryMode: "FRESH", recoveredTailTicks: 0, committedTicks: 0, stateAgentCount: 1, walSizeBytes: 0, snapshotCount: 0, tailTicksSinceSnapshot: 0 };
function mkReport(over: { budget?: number; driftMax?: number }): MetricsReport {
  return {
    observation: baseObs,
    performance: { tickDurationMs: stat(), tickDriftMs: stat(over.driftMax ?? 0), submitLatencyMs: stat(), snapshotDurationMs: stat(), recoveryDurationMs: 0 },
    estimatedRecoveryBudgetMs: over.budget ?? 0,
  };
}
const driftDetected: DriftResult = { status: "DRIFT_DETECTED", checked: 3, firstDivergence: { tick: 2n, field: "stateRoot", ts: "0xaa", oracle: "0xbb" } };
const driftOk: DriftResult = { status: "DRIFT_OK", checked: 3 };
const healthy = (drift?: DriftResult): { report: MetricsReport; drift?: DriftResult; nowMs: number } => ({ report: mkReport({ budget: 5_000, driftMax: 0 }), drift, nowMs: 1 });

test("no events when everything is clear", () => {
  const m = new AlertManager();
  assert.deepEqual(m.evaluate(healthy(driftOk)), []);
  assert.deepEqual(m.active(), []);
});

test("recovery-sla: WARNING → CRITICAL escalation → RESOLVED, deduplicated", () => {
  const m = new AlertManager();
  const atRisk = () => ({ report: mkReport({ budget: RECOVERY_SLA_MS * 0.85 }), nowMs: 1 });
  const violated = () => ({ report: mkReport({ budget: RECOVERY_SLA_MS }), nowMs: 2 });
  const ok = () => ({ report: mkReport({ budget: 5_000 }), nowMs: 3 });

  let ev = m.evaluate(atRisk());
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0]!.key, ev[0]!.state, ev[0]!.severity], ["recovery-sla", "FIRING", "WARNING"]);

  assert.deepEqual(m.evaluate(atRisk()), [], "still firing at the same severity ⇒ no repeat (dedup)");

  ev = m.evaluate(violated());
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0]!.key, ev[0]!.state, ev[0]!.severity], ["recovery-sla", "FIRING", "CRITICAL"], "escalation emits a fresh event");

  ev = m.evaluate(ok());
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0]!.key, ev[0]!.state], ["recovery-sla", "RESOLVED"]);
  assert.deepEqual(m.evaluate(ok()), [], "stays resolved silently");
});

test("scheduler-drift: fires WARNING/CRITICAL by threshold, no false positive below warn", () => {
  const m = new AlertManager();
  assert.deepEqual(m.evaluate({ report: mkReport({ driftMax: 100 }), nowMs: 1 }), [], "below warn ⇒ nothing");
  let ev = m.evaluate({ report: mkReport({ driftMax: 800 }), nowMs: 2 });
  assert.deepEqual([ev[0]?.key, ev[0]?.severity], ["scheduler-drift", "WARNING"]);
  ev = m.evaluate({ report: mkReport({ driftMax: 3_000 }), nowMs: 3 });
  assert.deepEqual([ev[0]?.key, ev[0]?.severity], ["scheduler-drift", "CRITICAL"], "escalates to crit");
  ev = m.evaluate({ report: mkReport({ driftMax: 0 }), nowMs: 4 });
  assert.deepEqual([ev[0]?.key, ev[0]?.state], ["scheduler-drift", "RESOLVED"]);
});

test("ts-go-drift: CRITICAL on a detected divergence, resolves on DRIFT_OK", () => {
  const m = new AlertManager();
  assert.deepEqual(m.evaluate(healthy(undefined)), [], "no drift result ⇒ not firing");
  let ev = m.evaluate(healthy(driftDetected));
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0]!.key, ev[0]!.state, ev[0]!.severity], ["ts-go-drift", "FIRING", "CRITICAL"]);
  assert.match(ev[0]!.message, /tick 2.*stateRoot/);
  assert.deepEqual(m.evaluate(healthy(driftDetected)), [], "dedup while drift persists");
  ev = m.evaluate(healthy(driftOk));
  assert.deepEqual([ev[0]?.key, ev[0]?.state], ["ts-go-drift", "RESOLVED"]);
});

test("rules are orthogonal — an SLA violation does not trip drift/scheduler rules", () => {
  const m = new AlertManager();
  const ev = m.evaluate({ report: mkReport({ budget: RECOVERY_SLA_MS, driftMax: 0 }), drift: driftOk, nowMs: 1 });
  assert.equal(ev.length, 1, "only one rule fires");
  assert.equal(ev[0]!.key, "recovery-sla");
});

test("active() lists firing alerts, highest severity first", () => {
  const m = new AlertManager();
  m.evaluate({ report: mkReport({ budget: RECOVERY_SLA_MS * 0.85, driftMax: 3_000 }), drift: driftDetected, nowMs: 1 });
  const active = m.active();
  assert.equal(active.length, 3, "sla(warn) + scheduler(crit) + ts-go(crit) all firing");
  assert.equal(active[0]!.severity, "CRITICAL", "criticals sorted ahead of the warning");
  assert.equal(active[active.length - 1]!.severity, "WARNING");
});
