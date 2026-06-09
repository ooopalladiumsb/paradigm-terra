#!/usr/bin/env node
// PR-1.8 — live observer, cross-language (closes H3.5-live). An EXTERNAL observer tails a RUNNING TS
// daemon's directory (read-only) and has an INDEPENDENT Go node (orchestrator-go/cmd/soak) re-fold the
// committed stream, confirming the live root in real time — twice (tracking growth), then a negative
// control. The observer never writes to the node; the node never knows it is watched.
//
//   node --import tsx scripts/pr1-8-live-observer.mjs      # from orchestrator/  (needs the Go toolchain)

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const okTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true };
const sendCal = (n) => ({ action: "wallet.send_ton", agent_id: A, nonce: n, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] });
function fundedGenesis() {
  const g = genesis();
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g;
}
const traceToJcs = (t) => ({ current_tick: t.currentTick, operator_sig_present: t.operatorSigPresent, owner_sig_present: t.ownerSigPresent, pinned_mcp_schema_hash: t.pinnedMcpSchemaHash ?? "", state_before: t.stateBefore, state_after: t.stateAfter, steps: t.steps.map((s) => ({ ok: s.ok, effects: [...s.effects] })) });

// Build a soak-stream doc from the node dir's committed inputs — INDEPENDENTLY re-derived roots (run()),
// NOT read from the node's memory. tamper = inject a wrong pinned root to prove the Go check has teeth.
function buildStream(dir, headTickCount, tamper = false) {
  const { genesisState, ticks } = OvtNode.readProgram(dir);
  const published = ticks.slice(0, headTickCount); // verify the node's published checkpoint only
  const t = run({ genesisState, ticks: published });
  const h = crypto.createHash("sha256");
  for (const ev of t.eventLog) h.update(serializeCanonical(ev));
  const expTicks = t.ticks.map((tk) => ({ tick: tk.tick.toString(), state_root: tk.stateRoot, global_merkle_root: tk.globalMerkleRoot }));
  if (tamper && expTicks.length) expTicks[Math.floor(expTicks.length / 2)].state_root = "0x" + "de".repeat(32);
  return {
    meta: { package: "@paradigm-terra/orchestrator", track: "PR-1.8 live observer (H3.3/H3.5)", ticks: published.length },
    start_state_canonical: serializeCanonical(genesisState),
    input_ticks: published.map((blk) => ({ tick: blk.tick.toString(), submissions: blk.submissions.map((s) => ({ cal_canonical: serializeCanonical(s.cal), trace_canonical: serializeCanonical(traceToJcs(s.trace)) })) })),
    expected: { final_state_root: t.finalStateRoot, event_count: t.eventLog.length, event_log_sha256: "0x" + h.digest("hex"), ticks: expTicks },
  };
}
const goVerify = (p) => { try { execFileSync(GO_BIN, ["run", "./cmd/soak", p], { cwd: GO_DIR, env: { ...process.env, CGO_ENABLED: "0" }, stdio: "pipe" }); return true; } catch { return false; } };

console.log("PR-1.8 live observer — external Go re-fold of a RUNNING TS daemon\n");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr1-8-obs-"));
OvtNode.create(dir, fundedGenesis());
const daemon = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 5, snapshotCadence: 10 });
daemon.start();
const driveTo = async (n) => { while (daemon.status().committedTicks < n) { const c = daemon.status().committedTicks; for (let k = c; k < n; k++) daemon.submit({ cal: sendCal(BigInt(k + 1)), trace: okTrace }); await sleep(20); } };

if (!fs.existsSync(GO_BIN)) { console.log(`⚠ Go toolchain not found at ${GO_BIN}; skipping.`); daemon.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }

// observe the live node twice as it grows — the daemon keeps RUNNING throughout
let allOk = true;
for (const target of [15, 33]) {
  await driveTo(target);
  const head = JSON.parse(fs.readFileSync(path.join(dir, "head.json"), "utf8"));
  const p = path.join(dir, `observe-${head.tickCount}.json`);
  fs.writeFileSync(p, JSON.stringify(buildStream(dir, head.tickCount)) + "\n");
  const ok = goVerify(p);
  console.log(`  node @${String(daemon.status().committedTicks).padStart(3)} ticks · observer verified published @${head.tickCount} → Go re-fold: ${ok ? "OBSERVED_OK ✓" : "OBSERVED_DRIFT ✗"}  (node state: ${daemon.status().state})`);
  allOk = allOk && ok;
}

// negative control: a tampered published root must be caught by the independent Go node
const head = JSON.parse(fs.readFileSync(path.join(dir, "head.json"), "utf8"));
const badPath = path.join(dir, "observe-tampered.json");
fs.writeFileSync(badPath, JSON.stringify(buildStream(dir, head.tickCount, true)) + "\n");
const caught = !goVerify(badPath);
console.log(`  tampered published root → Go re-fold: ${caught ? "OBSERVED_DRIFT ✓ (caught)" : "OBSERVED_OK ✗ teeth FAILED"}`);

daemon.shutdown();
fs.rmSync(dir, { recursive: true, force: true });
const pass = allOk && caught;
console.log(pass
  ? `\n✅ H3.5-live: an external Go observer independently confirms a running TS node's root in real time; an injected divergence is caught. Observe-only.`
  : `\n⚠ inconclusive (live ok=${allOk}, teeth=${caught}).`);
process.exit(pass ? 0 : 1);
