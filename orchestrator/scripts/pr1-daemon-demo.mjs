#!/usr/bin/env node
// PR-1.1a demo — drive the daemon as a live process and capture the FIRST operational profile.
// No network. Multi-agent feed faster than the tick rate so the mempool builds and drains ≤1/agent
// per tick (§6.1 single-in-flight). Then graceful shutdown (flush) + a post-shutdown recovery check
// (re-open the WAL → identical STATE_ROOT, the OVT-2 durability guarantee).
//
//   node --import tsx scripts/pr1-daemon-demo.mjs      # from orchestrator/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { genesis } from "@paradigm-terra/cal-reducer";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { OvtAgent, LocalTestOwnerSigner } from "../src/agent/ovt-agent.js";

const AGENTS = 4, ROUNDS = 12, FEED_MS = 25, TICK_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const subSeed = (tag) => crypto.createHash("sha256").update("pr1-demo").update(tag).digest();

// deterministic multi-agent set
const agents = Array.from({ length: AGENTS }, (_, i) => {
  const id = "0:" + i.toString(16).padStart(64, "0");
  const owner = new LocalTestOwnerSigner({ seed: subSeed(`owner:${i}`) });
  const agent = new OvtAgent(owner, { serverCmd: process.execPath, serverArgs: [], agentId: id, seed: subSeed(`op:${i}`) });
  return { id, owner, agent };
});

// merged genesis: register + fund every agent
const g = genesis();
for (const { id, owner, agent } of agents) {
  g.ptra.balances[id] = 10n ** 18n;
  g.registry.agents[id] = { granted_scopes: ["ton_transfer"], operator_pubkey: agent.operatorPubkeyHex(), owner_pubkey: owner.ownerPubkeyHex() };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr1-daemon-"));
OvtNode.create(dir, g); // provision the node dir (genesis + empty WAL); the daemon opens it

const daemon = new Pr1Daemon({ dir, genesisState: g, tickIntervalMs: TICK_MS });
console.log(`PR-1.1a daemon — ${AGENTS} agents × ${ROUNDS} rounds, feed ${FEED_MS}ms, tick ${TICK_MS}ms\n`);
daemon.start();
console.log(`  start → ${daemon.status().state}`);

// pre-mint each agent's CAL sequence (nonce 1..ROUNDS), then feed round-robin faster than the tick
const minted = [];
for (let r = 1; r <= ROUNDS; r++) for (const { agent } of agents) minted.push(await agent.mintSubmissionFast(BigInt(r), 0n, 1_000_000n));

const total = minted.length;
for (let i = 0; i < total; i++) {
  daemon.submit(minted[i]);
  if (i % AGENTS === 0) { const s = daemon.status(); process.stdout.write(`\r  feeding… submitted=${i + 1}/${total} mempool=${s.mempoolDepth} ticks=${s.committedTicks}   `); }
  await sleep(FEED_MS);
}
console.log("");

// let the scheduler drain the backlog
while (daemon.status().mempoolDepth > 0) await sleep(TICK_MS);
await sleep(TICK_MS * 2);

const m = daemon.shutdown();
console.log(`  shutdown → STOPPED\n`);

// durability check: re-fold the WAL from genesis → must equal the live root (OVT-2)
const recovered = OvtNode.open(dir);
const tr = recovered.getTranscript();
let finalized = 0, other = 0;
for (const tk of tr.ticks) for (const s of tk.submissions) (s.terminalStage === "FINALIZED" ? finalized++ : other++);
const rootMatch = recovered.stateRoot() === m.lastStateRoot;

console.log("FIRST OPERATIONAL PROFILE (PR-1.1a):");
console.log(`  uptime                : ${m.uptimeMs} ms`);
console.log(`  committed ticks       : ${m.committedTicks}  (idle ticks: ${m.idleTicks})`);
console.log(`  total submissions     : ${m.totalSubmissions}  → finalized ${finalized}, other ${other}`);
console.log(`  max mempool depth     : ${m.maxMempoolDepth}`);
console.log(`  tick latency avg/max  : ${m.tickLatencyMsAvg.toFixed(1)} / ${m.tickLatencyMsMax.toFixed(1)} ms  (grows with history — O(n) re-fold; PR-1.2 target)`);
console.log(`  max tick drift        : ${m.tickDriftMsMax} ms`);
console.log(`  cold recovery latency : ${m.recoveryLatencyMs.toFixed(1)} ms  (empty WAL here; ~2h/1M at scale — PR-1.2)`);
console.log(`  shutdown latency      : ${m.shutdownLatencyMs.toFixed(1)} ms`);
console.log(`  post-shutdown recover : root ${rootMatch ? "MATCHES" : "DIVERGES"} live (OVT-2 durability)`);

fs.rmSync(dir, { recursive: true, force: true });
const okClean = other === 0 && rootMatch && finalized === total;
console.log(okClean ? `\n✅ daemon ran as a process: all ${total} submissions FINALIZED, durable recovery exact.` : `\n⚠ inspect: finalized=${finalized}/${total}, other=${other}, rootMatch=${rootMatch}`);
process.exit(okClean ? 0 : 1);
