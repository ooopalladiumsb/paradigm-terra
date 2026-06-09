/**
 * PR-1.3-B Gate B3 — the SLA guard. Asserts the MODEL, never wall-clock time, so it is stable across
 * CI / laptop / server (actual timings live in scripts/pr1-3-recovery-profile.mjs):
 *
 *   (mechanism)   running cadence N ⇒ the recovery tail is bounded by N (so recovery ≤ the SLA budget).
 *   (budget)      the shipped cadence satisfies the SLA under the reference cost constants.
 *   (model fns)   maxTailForSla / operationalCadence / predictedRecoveryMs / snapshotDue are correct.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, type Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import {
  maxTailForSla,
  operationalCadence,
  predictedRecoveryMs,
  snapshotDue,
  OPERATIONAL_CADENCE_TICKS,
  RECOVERY_MARGIN_MS,
  RECOVERY_SLA_MS,
  REFERENCE_PER_TICK_RECOVERY_MS,
  REFERENCE_SNAPSHOT_LOAD_MS,
  SAFETY_FACTOR,
} from "../src/node/recovery-sla.js";

const A = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {} as Json, stateAfter: {} as Json, operatorSigPresent: true, ownerSigPresent: true };
function fundedGenesis(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return { cal: { action: "wallet.send_ton", agent_id: A, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] } as Json, trace: okTrace };
}
const blocks = (n: number) => Array.from({ length: n }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] }));
const fullRoot = (n: number) => run({ genesisState: fundedGenesis(), ticks: blocks(n) }).finalStateRoot;
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-3B-${tag}-`));

test("model fns: maxTailForSla / operationalCadence / predictedRecoveryMs / snapshotDue", () => {
  // SLA 60s, load 10ms, per_tick 0.4ms, margin 5s ⇒ N_max = (60000-10-5000)/0.4 = 137475
  assert.equal(maxTailForSla(60_000, 10, 0.4, 5_000), Math.floor((60_000 - 10 - 5_000) / 0.4));
  assert.equal(operationalCadence(60_000, 10, 0.4, 5_000), Math.floor(maxTailForSla(60_000, 10, 0.4, 5_000) / SAFETY_FACTOR));
  assert.equal(predictedRecoveryMs(1000, 10, 0.4, 5_000), 10 + 400 + 5_000);
  // never returns < 1 even with a brutal SLA
  assert.equal(operationalCadence(1, 10, 0.4, 5_000), 1);
  // snapshotDue: every N, never at 0
  assert.equal(snapshotDue(0, 10), false);
  assert.equal(snapshotDue(10, 10), true);
  assert.equal(snapshotDue(15, 10), false);
  assert.equal(snapshotDue(30, 10), true);
});

test("budget: the shipped cadence recovers within the SLA under the reference constants", () => {
  const worst = predictedRecoveryMs(OPERATIONAL_CADENCE_TICKS, REFERENCE_SNAPSHOT_LOAD_MS, REFERENCE_PER_TICK_RECOVERY_MS, RECOVERY_MARGIN_MS);
  assert.ok(worst <= RECOVERY_SLA_MS, `worst-case modelled recovery ${worst}ms exceeds SLA ${RECOVERY_SLA_MS}ms`);
  // and there is real headroom (safety factor ⇒ worst-case is roughly half the SLA budget)
  assert.ok(worst <= RECOVERY_SLA_MS / SAFETY_FACTOR + RECOVERY_MARGIN_MS, "cadence keeps a safety margin below the SLA");
  assert.ok(OPERATIONAL_CADENCE_TICKS >= 1, "cadence is a positive tick count");
});

test("mechanism: running cadence N bounds the recovery tail to ≤ N (any crash point)", () => {
  const N = 10; // small cadence for a fast deterministic test
  for (const T of [5, 10, 23, 30, 47]) {
    const dir = tmp(`mech-${T}`);
    const node = OvtNode.create(dir, fundedGenesis());
    for (let i = 0; i < T; i++) {
      node.submit([sendSub(BigInt(i + 1))]);
      node.maybeSnapshot(N); // the daemon's per-tick cadence call (PR-1.1b)
    }
    // recover (a "crash" at tick T): the tail replayed must be ≤ N, and the root must be exact
    const recovered = OvtNode.open(dir);
    const tail = recovered.getTranscript().ticks.length;
    assert.ok(tail <= N, `T=${T}: recovery tail ${tail} exceeds cadence ${N}`);
    assert.equal(recovered.stateRoot(), fullRoot(T), `T=${T}: recovered root == full`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mechanism: with a bounded tail, the predicted recovery stays within the SLA", () => {
  // the tail is bounded by the cadence (proven above); plug the operational cadence into the model
  const predicted = predictedRecoveryMs(OPERATIONAL_CADENCE_TICKS, REFERENCE_SNAPSHOT_LOAD_MS, REFERENCE_PER_TICK_RECOVERY_MS, RECOVERY_MARGIN_MS);
  assert.ok(predicted <= RECOVERY_SLA_MS, "bounded tail ⇒ predicted recovery ≤ SLA");
});
