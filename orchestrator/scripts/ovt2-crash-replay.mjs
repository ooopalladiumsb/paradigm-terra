#!/usr/bin/env node
// OVT-2 — Operational Correctness: the node is a PROCESS, not a function.
// Headline hypothesis:  crash → replay → same STATE_ROOT.
//
//   node --import tsx scripts/ovt2-crash-replay.mjs      # from orchestrator/
//
// Submissions are minted by the OVT agent (real signed CALs + executor-generated traces), fed to a
// persistent node across ticks, then the node is "crashed" (dropped with no clean shutdown) and
// recovered from its on-disk WAL. Exercises H2.1 (process/submit/tick-advance), H2.2 (persist),
// H2.3 (replay recovery), H2.4 (crash mid-tick = torn trailing WAL line), H2.5 (deterministic re-fold).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replay, verifyReplay } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { OvtAgent, LocalTestOwnerSigner } from "../src/agent/ovt-agent.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const serverPath = path.join(ROOT, "orchestrator/src/mcp/test-server.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovt2-node-"));

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

const agent = new OvtAgent(new LocalTestOwnerSigner(), { serverCmd: process.execPath, serverArgs: [serverPath] });
await agent.connect();

try {
  const genesis = agent.nodeGenesis();
  // Three real submissions over an evolving state (sequential nonces, one per tick).
  const subs = [await agent.buildSubmission(1n, 0n), await agent.buildSubmission(2n, 1n), await agent.buildSubmission(3n, 2n)];

  // ---- Node A: a live process accepting submissions and advancing ticks (H2.1/H2.2) ----
  const a = OvtNode.create(dir, genesis);
  const results = subs.map((s) => a.submit([s]));
  check("H2.1 process: 3 submissions across 3 ticks all FINALIZED", results.every((r) => r.submissions[0].terminalStage === "FINALIZED"), results.map((r) => r.submissions[0].terminalStage).join(","));
  const rootA = a.stateRoot();
  const logRootA = a.eventLogRoot();
  check("H2.2 persisted: WAL + genesis + head on disk", fs.existsSync(path.join(dir, "wal.ndjson")) && fs.existsSync(path.join(dir, "genesis.json")) && fs.existsSync(path.join(dir, "head.json")));

  // ---- CRASH: drop node A with NO clean shutdown; only the on-disk WAL survives ----
  // (no a.close()/flush — recovery must work from the durable WAL alone)

  // ---- Node B: recover by re-folding the WAL (H2.3 — the headline crash → replay) ----
  const b = OvtNode.open(dir);
  check("H2.3 crash → replay → same STATE_ROOT", b.stateRoot() === rootA, `${b.stateRoot().slice(0, 14)}… vs ${rootA.slice(0, 14)}…`);
  check("H2.3 recovered event-log Merkle root identical", b.eventLogRoot() === logRootA);
  check("H2.3 recovered tick count == 3", b.tickCount() === 3, `${b.tickCount()}`);

  // ---- Event-log replay axis: the EVENT LOG alone re-folds to the same roots ----
  check("event-log replay reproduces transcript roots (verifyReplay)", verifyReplay(b.getTranscript()));
  check("event-log replay finalStateRoot == STATE_ROOT", replay(b.eventLog(), genesis).finalStateRoot === rootA);

  // ---- H2.4: crash mid-tick = a torn trailing WAL line; recovery keeps the committed prefix ----
  fs.appendFileSync(path.join(dir, "wal.ndjson"), '{"tick":{"$bigint":"3"},"submi'); // partial, no newline
  const c = OvtNode.open(dir);
  check("H2.4 crash mid-tick: torn trailing line dropped, prefix intact", c.tickCount() === 3 && c.stateRoot() === rootA, `ticks=${c.tickCount()} root match=${c.stateRoot() === rootA}`);

  // ---- H2.5: deterministic re-fold — opening twice yields identical roots ----
  const d = OvtNode.open(dir);
  const e = OvtNode.open(dir);
  check("H2.5 deterministic re-fold: identical STATE_ROOT + event-log root across opens", d.stateRoot() === e.stateRoot() && d.stateRoot() === rootA && d.eventLogRoot() === e.eventLogRoot());
} finally {
  await agent.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nOVT-2 — operational correctness (node as a process)\n`);
let allOk = true;
for (const c of checks) { console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? "  — " + c.detail : ""}`); allOk = allOk && c.ok; }
console.log(`\n${allOk ? "✅ OVT-2: crash → replay → same STATE_ROOT; node recovers from its WAL, deterministically (H2.1–H2.5)." : "❌ OVT-2 FAILED"}`);
process.exit(allOk ? 0 : 1);
