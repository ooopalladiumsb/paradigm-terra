#!/usr/bin/env node
// PR-1.5 — live TS↔Go drift-watch (H3.3 continuous). A running TS daemon produces a committed stream;
// the watcher exports it and an INDEPENDENT Go node (orchestrator-go/cmd/soak) re-folds the identical
// stream and must reproduce every per-tick STATE_ROOT + CE §6.3 global root + the final root + the
// event-log SHA-256. The watch is passive: it observes agreement / reports DRIFT, it never reconciles.
// Negative control proves teeth: tamper one pinned root ⇒ the Go node disagrees ⇒ DRIFT_DETECTED.
//
//   node --import tsx scripts/pr1-5-drift-watch.mjs      # from orchestrator/  (needs the Go toolchain)

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_DIR = path.resolve(__dirname, "..", "..", "orchestrator-go");
const GO_BIN = process.env.GO_BIN || path.join(os.homedir(), ".local", "go", "bin", "go");
const A = "0:" + "cc".repeat(32);
const N = 24, CADENCE = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const okTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true };
const sendCal = (nonce) => ({ action: "wallet.send_ton", agent_id: A, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] });
function fundedGenesis() {
  const g = genesis();
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g;
}
const traceToJcs = (t) => ({
  current_tick: t.currentTick, operator_sig_present: t.operatorSigPresent, owner_sig_present: t.ownerSigPresent,
  pinned_mcp_schema_hash: t.pinnedMcpSchemaHash ?? "", state_before: t.stateBefore, state_after: t.stateAfter,
  steps: t.steps.map((s) => ({ ok: s.ok, effects: [...s.effects] })),
});

console.log(`PR-1.5 drift-watch — live TS daemon stream → independent Go re-fold (${N} ticks, cadence ${CADENCE})\n`);

// 1. a LIVE TS daemon processes the stream; its committed root must equal the batch run() we export
const program = { genesisState: fundedGenesis(), ticks: Array.from({ length: N }, (_, i) => ({ tick: BigInt(i), submissions: [{ cal: sendCal(BigInt(i + 1)), trace: okTrace }] })) };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr1-5-drift-"));
OvtNode.create(dir, fundedGenesis());
const daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 5, snapshotCadence: CADENCE });
daemon.start();
for (let i = 0; i < N; i++) daemon.submit({ cal: sendCal(BigInt(i + 1)), trace: okTrace });
for (let i = 0; i < 4000 && daemon.status().committedTicks < N; i++) await sleep(2);
const liveRoot = daemon.status().stateRoot;
daemon.shutdown();

const t = run(program);
if (liveRoot !== t.finalStateRoot) { console.error(`✗ live daemon root ${liveRoot} != batch ${t.finalStateRoot}`); process.exit(1); }
console.log(`  live daemon committed ${N} ticks; root == batch run() (${liveRoot.slice(0, 18)}…)`);

// 2. export the committed stream as a soak-stream doc (the cross-language contract cmd/soak verifies)
const h = crypto.createHash("sha256");
for (const ev of t.eventLog) h.update(serializeCanonical(ev));
const doc = {
  meta: { package: "@paradigm-terra/orchestrator", track: "PR-1.5 live drift-watch (H3.3 continuous)", ticks: N, generated_at: new Date().toISOString() },
  start_state_canonical: serializeCanonical(program.genesisState),
  input_ticks: program.ticks.map((blk) => ({ tick: blk.tick.toString(), submissions: blk.submissions.map((s) => ({ cal_canonical: serializeCanonical(s.cal), trace_canonical: serializeCanonical(traceToJcs(s.trace)) })) })),
  expected: { final_state_root: t.finalStateRoot, event_count: t.eventLog.length, event_log_sha256: "0x" + h.digest("hex"), ticks: t.ticks.map((tk) => ({ tick: tk.tick.toString(), state_root: tk.stateRoot, global_merkle_root: tk.globalMerkleRoot })) },
};
const cleanPath = path.join(dir, "stream.json");
fs.writeFileSync(cleanPath, JSON.stringify(doc) + "\n");

// 3. run the INDEPENDENT Go node over the identical stream
const goVerify = (p) => {
  try {
    execFileSync(GO_BIN, ["run", "./cmd/soak", p], { cwd: GO_DIR, env: { ...process.env, CGO_ENABLED: "0" }, stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || "") };
  }
};
if (!fs.existsSync(GO_BIN)) { console.log(`\n⚠ Go toolchain not found at ${GO_BIN} — set GO_BIN. Skipping the live Go check.`); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }

const clean = goVerify(cleanPath);
console.log(`  clean stream  → Go re-fold: ${clean.ok ? "DRIFT_OK ✓ (every root reproduced)" : "DRIFT_DETECTED ✗ — unexpected!"}`);

// 4. negative control: tamper one pinned root ⇒ the Go node must disagree
const tampered = JSON.parse(JSON.stringify(doc));
tampered.expected.ticks[Math.floor(N / 2)].state_root = "0x" + "de".repeat(32);
const tamperedPath = path.join(dir, "stream-tampered.json");
fs.writeFileSync(tamperedPath, JSON.stringify(tampered) + "\n");
const bad = goVerify(tamperedPath);
console.log(`  tampered root → Go re-fold: ${bad.ok ? "DRIFT_OK ✗ — teeth FAILED!" : "DRIFT_DETECTED ✓ (Go caught the injected divergence)"}`);

fs.rmSync(dir, { recursive: true, force: true });
const pass = clean.ok && !bad.ok;
console.log(pass
  ? `\n✅ TS↔Go drift-watch: live stream agrees; an injected divergence is caught. Monitoring observes; consensus decides.`
  : `\n⚠ drift-watch inconclusive (clean ok=${clean.ok}, tampered ok=${bad.ok}).`);
process.exit(pass ? 0 : 1);
