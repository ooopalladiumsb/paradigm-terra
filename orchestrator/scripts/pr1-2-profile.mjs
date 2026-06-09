#!/usr/bin/env node
// PR-1.2b Gate 3 — the curve-shape profile. Drive OvtNode.submit() directly for many ticks and
// measure per-submit latency at growing history sizes. The PR-1.1a wall was O(n)/tick (submit
// re-folded the whole WAL from genesis); after PR-1.2b submit advances a carried IncrementalState by
// one tick, so the question is the SHAPE: is latency(t) ≈ const, or does a hidden full re-fold remain?
//
//   node --import tsx scripts/pr1-2-profile.mjs      # from orchestrator/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { genesis } from "@paradigm-terra/cal-reducer";
import { OvtNode } from "../src/node/persistent-node.js";

const TICKS = 400;
const CHECKPOINTS = [50, 100, 150, 200, 400];
const A = "0:" + "cc".repeat(32);

const g = genesis();
g.ptra.balances[A] = 10n ** 18n;
g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };

const okTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true };
const sendCal = (nonce) => ({
  action: "wallet.send_ton",
  agent_id: A,
  nonce,
  expiration_tick: 10_000_000n,
  preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
  invariants: [],
  steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr1-2-profile-"));
const node = OvtNode.create(dir, g);

console.log(`PR-1.2b Gate 3 profile — single agent, ${TICKS} ticks, one send_ton/tick (incremental submit)\n`);

// per-submit latency, in window buckets, to read the curve shape
const lat = [];
let finalized = 0;
for (let i = 0; i < TICKS; i++) {
  const t0 = performance.now();
  const tr = node.submit([{ cal: sendCal(BigInt(i + 1)), trace: okTrace }]);
  lat.push(performance.now() - t0);
  if (tr.submissions[0]?.terminalStage === "FINALIZED") finalized++;
}

// windowed averages around each checkpoint (±10 ticks) — the SHAPE, not a single noisy sample
const windowAvg = (center) => {
  const lo = Math.max(0, center - 11), hi = Math.min(lat.length, center);
  const s = lat.slice(lo, hi);
  return s.reduce((a, b) => a + b, 0) / s.length;
};

console.log("  per-submit latency by history size (avg of the ~10 submits ending at each checkpoint):");
const samples = [];
for (const c of CHECKPOINTS) {
  if (c > TICKS) continue;
  const a = windowAvg(c);
  samples.push({ c, a });
  console.log(`    tick ${String(c).padStart(4)} : ${a.toFixed(3)} ms/submit`);
}

const first = samples[0].a, last = samples[samples.length - 1].a;
const ratio = last / first;
const maxLat = Math.max(...lat), avgLat = lat.reduce((a, b) => a + b, 0) / lat.length;

console.log(`\n  overall: avg ${avgLat.toFixed(3)} ms/submit · max ${maxLat.toFixed(3)} ms · finalized ${finalized}/${TICKS}`);
console.log(`  curve:   tick${samples[0].c}=${first.toFixed(3)}ms → tick${samples[samples.length - 1].c}=${last.toFixed(3)}ms · growth ×${ratio.toFixed(2)}`);

// recovery is still O(history) until PR-1.2c (snapshots); report it for context
const t0 = performance.now();
const re = OvtNode.open(dir);
const recMs = performance.now() - t0;
const rootMatch = re.stateRoot() === node.stateRoot();
console.log(`  cold recovery (full WAL re-fold, ${TICKS} ticks): ${recMs.toFixed(1)} ms · root ${rootMatch ? "MATCHES" : "DIVERGES"}  (PR-1.2c target)`);

fs.rmSync(dir, { recursive: true, force: true });

// Gate 3 verdict: flat curve (generous bound — a reintroduced O(n) re-fold would be ×50+ over this span)
const flat = ratio < 4 && rootMatch && finalized === TICKS;
console.log(flat ? `\n✅ Gate 3: latency(t) ≈ const (growth ×${ratio.toFixed(2)} over 8× more history) — the O(n)/tick runtime wall is gone.`
  : `\n⚠ Gate 3: curve grew ×${ratio.toFixed(2)} — inspect for a residual full re-fold.`);
process.exit(flat ? 0 : 1);
