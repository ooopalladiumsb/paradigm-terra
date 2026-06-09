#!/usr/bin/env node
// OVT-SG — State Growth Validation. The silent failure mode: formally correct ≠ operable at scale.
// MEASURE, do not optimize (Gate-#2 discipline): record the recovery/replay cost curve vs log size,
// classify the growth shape (linear vs super-linear), extrapolate. A super-linear result is flagged
// as an operational Tier-2 candidate — NOT fixed here, and NOT a Freeze-Surface defect (the root
// VALUES are proven correct; this measures operational cost).
//
//   node --import tsx scripts/ovt-sg-growth.mjs      # from orchestrator/
//
// What it measures, per log size N (one finalized CAL per tick, sequential nonces, one agent):
//   • cold recovery time = OvtNode.open() = read WAL + re-fold from genesis (== crash-recovery time)
//   • ns per event, event-log length, WAL bytes
// State for one agent is bounded by design (nonce is a single counter; finalized CALs clear
// in_flight), so the unbounded thing is the event log — and recovery re-folds it. Recovery cost vs
// log size is therefore THE state-growth metric.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OvtNode } from "../src/node/persistent-node.js";
import { OvtAgent, LocalTestOwnerSigner } from "../src/agent/ovt-agent.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIZES = [1000, 4000, 16000];

const rows = [];
for (const N of SIZES) {
  const agent = new OvtAgent(new LocalTestOwnerSigner(), { serverCmd: process.execPath, serverArgs: [] }); // no MCP connect — fast mint
  const ticks = [];
  for (let i = 0; i < N; i++) ticks.push({ tick: BigInt(i), submissions: [await agent.mintSubmissionFast(BigInt(i + 1), BigInt(i))] });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ovt-sg-${N}-`));
  OvtNode.bulkCreate(dir, agent.nodeGenesis(), ticks);

  // cold recovery: read WAL + re-fold from genesis (this IS crash-recovery)
  const t0 = process.hrtime.bigint();
  const node = OvtNode.open(dir);
  const recoveryNs = Number(process.hrtime.bigint() - t0);

  const events = node.eventLog().length;
  const walBytes = fs.statSync(path.join(dir, "wal.ndjson")).size;
  // sanity: recovery must actually reproduce a consistent root (correctness is OVT-2's job; we only
  // confirm the large log still folds cleanly here)
  const okRoot = node.stateRoot() === OvtNode.open(dir).stateRoot();
  rows.push({ N, events, walBytes, recoveryMs: recoveryNs / 1e6, nsPerEvent: recoveryNs / events, okRoot });
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- report ---
console.log(`\nOVT-SG — state-growth / recovery-cost curve (one agent, one finalized CAL per tick)\n`);
console.log("| N (ticks) | events | WAL bytes | recovery ms | ns/event | re-fold stable |");
console.log("|--:|--:|--:|--:|--:|---|");
for (const r of rows) {
  console.log(`| ${r.N} | ${r.events} | ${(r.walBytes / 1024).toFixed(0)} KiB | ${r.recoveryMs.toFixed(1)} | ${r.nsPerEvent.toFixed(0)} | ${r.okRoot ? "✅" : "❌"} |`);
}

// classify the growth shape from ns/event spread (linear ⇒ ~constant; super-linear ⇒ grows with N)
const nsPer = rows.map((r) => r.nsPerEvent);
const ratio = Math.max(...nsPer) / Math.min(...nsPer);
const linear = ratio < 1.8; // ns/event within 1.8× across a 16× size range ⇒ effectively linear
const avgNsPerEvent = nsPer.reduce((a, b) => a + b, 0) / nsPer.length;
const eventsPerCal = rows[0].events / rows[0].N;
const extrap1M = (avgNsPerEvent * 1_000_000 * eventsPerCal) / 1e9; // 1M CALs → seconds

const allStable = rows.every((r) => r.okRoot);
const PRACTICAL_1M_SECONDS = 60; // a cold node should recover ~1M CALs in well under a minute
const practical = extrap1M <= PRACTICAL_1M_SECONDS;

console.log(`\nns/event spread across ${Math.max(...SIZES) / Math.min(...SIZES)}× size range: ${ratio.toFixed(2)}× → ${linear ? "LINEAR (O(n))" : "SUPER-LINEAR"}`);
console.log(`extrapolated cold recovery for 1,000,000 CALs (~${eventsPerCal} events each): ~${extrap1M.toFixed(0)} s`);

if (linear && allStable && practical) {
  console.log(`\n✅ OVT-SG: recovery linear AND practical at scale, state bounded — DoD met.`);
} else if (linear && allStable && !practical) {
  console.log(`\n⚠ OVT-SG: growth is LINEAR (no O(n²) trap) and state is bounded, BUT the cold re-fold constant`);
  console.log(`   (~${(avgNsPerEvent / 1000).toFixed(0)} µs/event, STATE_ROOT recomputed per event) makes full-from-genesis recovery`);
  console.log(`   impractical at scale (~${extrap1M.toFixed(0)} s for 1M CALs). The OVT-SG DoD requires STATE CHECKPOINTING`);
  console.log(`   / snapshots (recover = load snapshot + replay tail). Operational Tier-2 candidate — do NOT`);
  console.log(`   implement here; NOT a Freeze-Surface defect (roots are correct).`);
} else {
  console.log(`\n⚠ OVT-SG: ${!linear ? "SUPER-LINEAR recovery growth" : "re-fold instability"} — investigate.`);
}
// Advisory measurement (like Gate #2): exit 0 on a clean, stable, linear curve even if the constant
// flags a checkpointing requirement; only hard-fail on super-linear growth or re-fold instability.
process.exit(linear && allStable ? 0 : 1);
