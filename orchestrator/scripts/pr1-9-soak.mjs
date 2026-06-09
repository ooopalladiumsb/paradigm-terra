#!/usr/bin/env node
// PR-1.9 — soak harness, accelerated representative run. A multi-agent daemon runs a long continuous
// stream; the harness samples the invariants (PR-1.4–1.8) throughout, performs a crash/restart inside
// the run, and verifies TS↔Go agreement at a checkpoint via the independent Go node. PURELY EVIDENTIAL:
// it observes/measures/records/reports and changes nothing. A real multi-day soak runs the same loop
// longer; this proves the harness + that the invariants hold over a representative run.
//
//   node --import tsx scripts/pr1-9-soak.mjs      # from orchestrator/  (Go optional, for the drift checkpoint)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { genesis } from "@paradigm-terra/cal-reducer";
import { serializeCanonical } from "@paradigm-terra/canonical";
import { run } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { LiveObserver } from "../src/node/live-observer.js";
import { detectDrift } from "../src/node/monitoring.js";
import { SoakMonitor } from "../src/node/soak.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_DIR = path.resolve(__dirname, "..", "..", "orchestrator-go");
const GO_BIN = process.env.GO_BIN || path.join(os.homedir(), ".local", "go", "bin", "go");
const AGENTS = 4, ROUNDS = 120, CADENCE = 50, TICK_MS = 25, SAMPLE_EVERY = 4, RESTART_AT = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agentId = (i) => "0:" + i.toString(16).padStart(64, "0");
const okTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true };
const sendCal = (agent, nonce) => ({ action: "wallet.send_ton", agent_id: agent, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${agent}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] });
function fundedGenesis() {
  const g = genesis();
  for (let i = 0; i < AGENTS; i++) { const id = agentId(i); g.ptra.balances[id] = 10n ** 18n; g.registry.agents[id] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) }; }
  return g;
}
const traceToJcs = (t) => ({ current_tick: t.currentTick, operator_sig_present: t.operatorSigPresent, owner_sig_present: t.ownerSigPresent, pinned_mcp_schema_hash: t.pinnedMcpSchemaHash ?? "", state_before: t.stateBefore, state_after: t.stateAfter, steps: t.steps.map((s) => ({ ok: s.ok, effects: [...s.effects] })) });

console.log(`PR-1.9 soak — ${AGENTS} agents, ${ROUNDS} rounds, cadence ${CADENCE}, restart @round ${RESTART_AT}\n`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr1-9-soak-"));
OvtNode.create(dir, fundedGenesis());
// scheduler-drift bound generous: the accelerated harness perturbs its own scheduling via synchronous
// observe() sampling (a real soak samples cheaply). The correctness-bearing alerts still escalate.
const mon = new SoakMonitor({ cadence: CADENCE, alertThresholds: { driftWarnMs: 5_000, driftCritMs: 60_000 } });
const observer = new LiveObserver();
let daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: TICK_MS, snapshotCadence: CADENCE });
daemon.start();
const nonces = Array.from({ length: AGENTS }, () => 0n);
// per-sample = CHEAP (metrics only): heavy independent verification (observe re-fold + Go subprocess)
// would starve the daemon's own event loop and self-induce scheduler drift, so it runs AFTER shutdown.
const sample = () => mon.record(daemon.metricsReport(), { heapBytes: process.memoryUsage().heapUsed, nowMs: Date.now() });

for (let r = 0; r < ROUNDS; r++) {
  for (let a = 0; a < AGENTS; a++) { nonces[a] += 1n; daemon.submit({ cal: sendCal(agentId(a), nonces[a]), trace: okTrace }); }
  await sleep(TICK_MS * 2);
  if (r === RESTART_AT) {
    while (daemon.status().mempoolDepth > 0) await sleep(TICK_MS); // quiesce before the crash
    daemon.simulateCrash();
    daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: TICK_MS, snapshotCadence: CADENCE });
    daemon.start();
    mon.noteRestart();
    console.log(`  ↻ crash/restart @round ${r}: recovered via ${daemon.status().recoveryMode}, tail ${daemon.status().recoveredTailTicks}, @${daemon.status().committedTicks} ticks`);
  }
  if (r % SAMPLE_EVERY === 0) { while (daemon.status().mempoolDepth > 0) await sleep(TICK_MS); sample(); }
}
while (daemon.status().mempoolDepth > 0) await sleep(TICK_MS);
sample();
daemon.shutdown(); // STOP the daemon before the heavy consensus verification, so it cannot perturb scheduling

// --- consensus verification, OUT OF BAND (daemon stopped) ---
// (a) external live observer re-derives the published root independently;
const obs = observer.observe(dir);
// (b) independent Go node re-folds the WHOLE committed stream (continuous TS↔Go parity over the soak).
let goVerdict = "skipped (no Go toolchain)";
let goDrift;
if (fs.existsSync(GO_BIN)) {
  const head = JSON.parse(fs.readFileSync(path.join(dir, "head.json"), "utf8"));
  const { genesisState, ticks } = OvtNode.readProgram(dir);
  const published = ticks.slice(0, head.tickCount);
  const t = run({ genesisState, ticks: published });
  const h = crypto.createHash("sha256");
  for (const ev of t.eventLog) h.update(serializeCanonical(ev));
  const doc = { meta: { track: "PR-1.9 soak Go checkpoint" }, start_state_canonical: serializeCanonical(genesisState), input_ticks: published.map((b) => ({ tick: b.tick.toString(), submissions: b.submissions.map((s) => ({ cal_canonical: serializeCanonical(s.cal), trace_canonical: serializeCanonical(traceToJcs(s.trace)) })) })), expected: { final_state_root: t.finalStateRoot, event_count: t.eventLog.length, event_log_sha256: "0x" + h.digest("hex"), ticks: t.ticks.map((tk) => ({ tick: tk.tick.toString(), state_root: tk.stateRoot, global_merkle_root: tk.globalMerkleRoot })) } };
  const p = path.join(dir, "soak-checkpoint.json");
  fs.writeFileSync(p, JSON.stringify(doc) + "\n");
  let ok = true;
  try { execFileSync(GO_BIN, ["run", "./cmd/soak", p], { cwd: GO_DIR, env: { ...process.env, CGO_ENABLED: "0" }, stdio: "pipe" }); } catch { ok = false; }
  goVerdict = ok ? "DRIFT_OK ✓" : "DRIFT_DETECTED ✗";
  goDrift = { status: ok ? "DRIFT_OK" : "DRIFT_DETECTED", checked: published.length };
}
// record the consensus checks against the daemon's final (stopped) state — does not affect drift
mon.record(daemon.metricsReport(), { observer: obs, drift: goDrift, nowMs: Date.now() });

const rep = mon.report();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nSOAK REPORT`);
console.log(`  committed ticks   : ${rep.committedTicks}`);
console.log(`  samples           : ${rep.samples}   restarts: ${rep.restarts}`);
console.log(`  max tail / cadence : ${rep.maxTailTicks} / ${CADENCE}`);
console.log(`  max budget / SLA   : ${rep.maxBudgetMs.toFixed(0)}ms / 60000ms`);
console.log(`  state agents       : ${rep.maxStateAgents}`);
console.log(`  heap growth        : ${(rep.growth.heapBytesPerSec / 1024).toFixed(1)} KiB/s over ${(rep.growth.spanMs / 1000).toFixed(1)}s`);
console.log(`  wal growth         : ${(rep.growth.walBytesPerSec / 1024).toFixed(1)} KiB/s`);
console.log(`  TS↔Go checkpoint   : ${goVerdict}`);
console.log(`  violations         : ${rep.violations.length}`);
for (const v of rep.violations) console.log(`    ✗ [${v.class}] @${v.committedTicks}: ${v.detail}`);
console.log(rep.ok ? `\n✅ Soak PASSED: all invariants held across ${rep.committedTicks} ticks and ${rep.restarts} restart(s). PR-1 readiness gate green.` : `\n⚠ Soak FAILED: ${rep.violations.length} violation(s) — opens a corrective PR (PR-1.9 itself changes nothing).`);
process.exit(rep.ok ? 0 : 1);
