#!/usr/bin/env node
// A1 — Long-duration Soak Program, accelerated representative run (the operational driver; the CI
// code-acceptance is test/a1-soak.test.ts). A multi-agent daemon runs a continuous stream; the program
// samples the PR-1.9 invariants PLUS the A1 additions — SC-4 periodic restore-equivalence and SC-6
// fd/disk/heap — across a crash/restart, and gates on zero violations. PURELY EVIDENTIAL: it observes
// and reports, changes nothing. A real multi-day soak runs the same loop longer (see a1-soak-runbook.md):
//
//   node --import tsx scripts/a1-soak.mjs                       # accelerated (~minutes)
//   A1_ROUNDS=200000 A1_TARGET_MS=604800000 node --import tsx scripts/a1-soak.mjs   # a 7-day run
//
// Env: A1_ROUNDS (default 160), A1_TARGET_MS (SC-1 window; default 0 = no duration gate).
// SC-4 restore-equivalence + SC-5 observer run at a few checkpoints with the daemon STOPPED (so the
// heavy O(history) work never starves live ticking — the pr1-9 lesson) + once at the end.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { genesis } from "@paradigm-terra/cal-reducer";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { LiveObserver } from "../src/node/live-observer.js";
import { SoakProgram, countOpenFds, dirBytes } from "../src/node/soak-program.js";

const AGENTS = 4;
const ROUNDS = Number(process.env.A1_ROUNDS ?? 160);
const TARGET_MS = Number(process.env.A1_TARGET_MS ?? 0);
const CADENCE = 50, TICK_MS = 25, SAMPLE_EVERY = 4, RESTART_AT = Math.floor(ROUNDS / 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agentId = (i) => "0:" + i.toString(16).padStart(64, "0");
const okTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true };
const sendCal = (agent, nonce) => ({ action: "wallet.send_ton", agent_id: agent, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${agent}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] });
function fundedGenesis() {
  const g = genesis();
  for (let i = 0; i < AGENTS; i++) { const id = agentId(i); g.ptra.balances[id] = 10n ** 18n; g.registry.agents[id] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) }; }
  return g;
}
const liveRoots = (d) => { const o = d.metricsReport().observation; return { stateRoot: o.stateRoot, globalRoot: o.globalRoot, eventCount: o.eventCount, lastEventHash: o.lastEventHash, committedTicks: o.committedTicks }; };

console.log(`A1 soak — ${AGENTS} agents, ${ROUNDS} rounds, cadence ${CADENCE}, restart @round ${RESTART_AT}${TARGET_MS ? `, SC-1 target ${(TARGET_MS / 1000).toFixed(0)}s` : ""}\n`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a1-soak-"));
OvtNode.create(dir, fundedGenesis());
const prog = new SoakProgram({ cadence: CADENCE, targetDurationMs: TARGET_MS, alertThresholds: { driftWarnMs: 5_000, driftCritMs: 60_000 } });
const observer = new LiveObserver();
let daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: TICK_MS, snapshotCadence: CADENCE });
daemon.start();
const nonces = Array.from({ length: AGENTS }, () => 0n);
let checkpointN = 0;
const CHECKPOINT_EVERY = Math.max(SAMPLE_EVERY, Math.floor(ROUNDS / 4)); // a few SC-4/SC-5 checkpoints

const quiesce = async () => { while (daemon.status().mempoolDepth > 0) await sleep(TICK_MS); };
// CHEAP per-sample (metrics + resources only). pr1-9's lesson: heavy O(history) work here (observer
// re-fold / backup+restore) starves the daemon's own loop and self-induces scheduler drift.
const cheapSample = () => {
  prog.record(daemon.metricsReport(), { heapBytes: process.memoryUsage().heapUsed, nowMs: Date.now() });
  prog.sampleResources({ fds: countOpenFds(), diskBytes: dirBytes(dir), heapBytes: process.memoryUsage().heapUsed, atMs: Date.now() });
};
// HEAVY SC-4 (restore-equivalence) + SC-5 (live observer) — run with the daemon STOPPED so they never
// compete with live ticking (a real multi-day soak, ticking seconds apart, runs them in-line cheaply).
const checkpoint = () => {
  prog.record(daemon.metricsReport(), { observer: observer.observe(dir), heapBytes: process.memoryUsage().heapUsed, nowMs: Date.now() }); // SC-5
  prog.checkRestoreEquivalence(dir, liveRoots(daemon)); // SC-4
};

for (let r = 0; r < ROUNDS; r++) {
  for (let a = 0; a < AGENTS; a++) { nonces[a] += 1n; daemon.submit({ cal: sendCal(agentId(a), nonces[a]), trace: okTrace }); }
  await sleep(TICK_MS * 2);
  if (r === RESTART_AT) {
    await quiesce();
    daemon.simulateCrash();
    daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: TICK_MS, snapshotCadence: CADENCE });
    daemon.start();
    prog.noteRestart();
    console.log(`  ↻ crash/restart @round ${r}: recovered via ${daemon.status().recoveryMode}, @${daemon.status().committedTicks} ticks`);
  } else if (r > 0 && r % CHECKPOINT_EVERY === 0) {
    await quiesce();
    daemon.shutdown(); // pause ticking for the heavy checks (not a crash — no noteRestart)
    checkpoint();
    checkpointN++;
    daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: TICK_MS, snapshotCadence: CADENCE });
    daemon.start();
  }
  if (r % SAMPLE_EVERY === 0) { await quiesce(); cheapSample(); }
}
await quiesce();
cheapSample();
daemon.shutdown(); // final SC-4/SC-5 out of band (daemon stopped), as PR-1.9 does
checkpoint();
checkpointN++;

const rep = prog.report();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nA1 SOAK REPORT`);
console.log(`  committed ticks   : ${rep.base.committedTicks}`);
console.log(`  samples / restarts: ${rep.base.samples} / ${rep.base.restarts}`);
console.log(`  duration          : ${(rep.durationMs / 1000).toFixed(1)}s${rep.targetDurationMs ? ` / target ${(rep.targetDurationMs / 1000).toFixed(0)}s (met: ${rep.durationMet})` : ""}`);
console.log(`  SC-4 restore checks: ${rep.restoreChecks} (all equivalent unless flagged below)`);
console.log(`  SC-6 max fds       : ${rep.resource.maxFds}  fd rate ${rep.resource.fdRatePerSec.toFixed(3)}/s`);
console.log(`  SC-6 max disk      : ${(rep.resource.maxDiskBytes / 1024).toFixed(1)} KiB  disk rate ${(rep.resource.diskBytesPerSec / 1024).toFixed(2)} KiB/s`);
console.log(`  SC-6 heap rate     : ${(rep.resource.heapBytesPerSec / 1024).toFixed(2)} KiB/s`);
console.log(`  max tail / cadence : ${rep.base.maxTailTicks} / ${CADENCE}`);
const all = [...rep.base.violations.map((v) => ({ ...v })), ...rep.a1Violations];
console.log(`  violations         : ${all.length}`);
for (const v of all) console.log(`    ✗ [${v.class}]: ${v.detail}`);
console.log(rep.ok ? `\n✅ A1 soak PASSED: SC-1..6 held across ${rep.base.committedTicks} ticks, ${rep.base.restarts} restart(s), ${rep.restoreChecks} restore-equivalence checks.` : `\n⚠ A1 soak FAILED: ${all.length} violation(s) — opens a corrective item (A1 itself changes nothing).`);
process.exit(rep.ok ? 0 : 1);
