#!/usr/bin/env node
// PR-1.3-B — recovery cost-model profiler. Validates  T_recovery ≈ snapshot_load + tail × per_tick
// and derives the cadence N for the SLA. Measurement artifact (the SLA GUARD test asserts the model,
// not wall-clock time, so it stays CI-stable; the real numbers live here).
//
//   node --import tsx scripts/pr1-3-recovery-profile.mjs      # from orchestrator/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { genesis } from "@paradigm-terra/cal-reducer";
import { OvtNode } from "../src/node/persistent-node.js";
import { maxTailForSla, operationalCadence, RECOVERY_SLA_MS, RECOVERY_MARGIN_MS, SAFETY_FACTOR } from "../src/node/recovery-sla.js";

const ok = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true };
const agentId = (i) => "0:" + i.toString(16).padStart(64, "0");
const cal = (agent, nonce) => ({ action: "wallet.send_ton", agent_id: agent, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${agent}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] });
function genWith(nAgents) {
  const s = genesis();
  for (let i = 0; i < nAgents; i++) {
    const id = agentId(i);
    s.ptra.balances[id] = 10n ** 18n;
    s.registry.agents[id] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  }
  return s;
}
// single-agent program of N ticks (agent 0), nonce 1..N
const prog = (N) => Array.from({ length: N }, (_, i) => ({ tick: BigInt(i), submissions: [{ cal: cal(agentId(0), BigInt(i + 1)), trace: ok }] }));
const timeOpen = (dir) => { const t = performance.now(); const r = OvtNode.open(dir); return { ms: performance.now() - t, node: r }; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log("PR-1.3-B recovery cost-model profile\n");

// --- per_tick_recovery_cost: NO snapshot ⇒ open() parses + folds all N (tail = N). slope = per_tick.
console.log("per_tick_recovery_cost (no snapshot ⇒ tail = N; parse + fold):");
const ptPoints = [];
for (const N of [300, 600, 1200]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sla-pt-"));
  OvtNode.bulkCreate(dir, genWith(1), prog(N));
  const samples = [timeOpen(dir).ms, timeOpen(dir).ms];
  const ms = mean(samples);
  ptPoints.push({ N, ms });
  console.log(`  N=${String(N).padStart(6)}  open=${ms.toFixed(1)}ms  ${(ms / N).toFixed(4)} ms/tick`);
  fs.rmSync(dir, { recursive: true, force: true });
}
// slope between the extreme points (intercept ≈ fixed open overhead)
const lo = ptPoints[0], hi = ptPoints[ptPoints.length - 1];
const perTick = (hi.ms - lo.ms) / (hi.N - lo.N);
const openOverhead = lo.ms - perTick * lo.N;
console.log(`  ⇒ per_tick_recovery ≈ ${perTick.toFixed(4)} ms/tick, fixed overhead ≈ ${openOverhead.toFixed(1)} ms\n`);

// --- snapshot_load: snapshot covers ALL ⇒ empty tail ⇒ open() = load + overhead, flat vs history.
console.log("snapshot_load (snapshot covers all ⇒ empty tail; should be ~flat vs history):");
const loadPoints = [];
for (const N of [300, 600, 1200]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sla-ld-"));
  const node = OvtNode.bulkCreate(dir, genWith(1), prog(N));
  node.snapshot();
  const ms = mean([timeOpen(dir).ms, timeOpen(dir).ms, timeOpen(dir).ms]);
  loadPoints.push(ms);
  console.log(`  N=${String(N).padStart(6)}  open=${ms.toFixed(2)}ms  (tail 0)`);
  fs.rmSync(dir, { recursive: true, force: true });
}
const snapshotLoad = mean(loadPoints);
console.log(`  ⇒ snapshot_load ≈ ${snapshotLoad.toFixed(2)} ms (flat — f(state), not f(history))\n`);

// --- state-size dimension: per_tick folds stateRootOf(whole state) ⇒ grows with the agent set (OVT-SG).
console.log("state-size sensitivity (per_tick at fixed tail=2000, varying agent count):");
for (const A of [1, 200]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sla-st-"));
  OvtNode.bulkCreate(dir, genWith(A), prog(300)); // agent 0 runs; the other A-1 just inflate state
  const ms = mean([timeOpen(dir).ms, timeOpen(dir).ms]);
  console.log(`  agents=${String(A).padStart(5)}  open(tail=300)=${ms.toFixed(0)}ms  ${(ms / 300).toFixed(4)} ms/tick`);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("  (per_tick scales with state size — reference N below is for a small/representative state)\n");

// --- derive cadence N for the SLA from the measured model -----------------------------------------
const nMax = maxTailForSla(RECOVERY_SLA_MS, snapshotLoad, perTick, RECOVERY_MARGIN_MS);
const nOp = operationalCadence(RECOVERY_SLA_MS, snapshotLoad, perTick, RECOVERY_MARGIN_MS);
console.log("cadence derivation (T_SLA = " + RECOVERY_SLA_MS / 1000 + "s):");
console.log(`  N_max         = (${RECOVERY_SLA_MS} - ${snapshotLoad.toFixed(0)} - ${RECOVERY_MARGIN_MS}) / ${perTick.toFixed(4)} ≈ ${nMax.toLocaleString()} ticks`);
console.log(`  N_operational = N_max / ${SAFETY_FACTOR} ≈ ${nOp.toLocaleString()} ticks  (the cadence policy)`);
console.log(`  predicted recovery @ tail=N_operational ≈ ${((snapshotLoad + nOp * perTick + RECOVERY_MARGIN_MS) / 1000).toFixed(1)} s  ≤ ${RECOVERY_SLA_MS / 1000} s ✓`);
