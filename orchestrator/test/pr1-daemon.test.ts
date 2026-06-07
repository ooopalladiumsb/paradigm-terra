/**
 * PR-1.1a daemon skeleton — lifecycle + process behavior (above the Freeze Surface).
 * Short real-timer runs: start→RUNNING, submit→tick→FINALIZED, graceful shutdown→STOPPED, and a
 * post-shutdown recovery check (re-fold the WAL → identical STATE_ROOT, the OVT-2 guarantee).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { genesis, type State } from "@paradigm-terra/cal-reducer";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { OvtAgent, LocalTestOwnerSigner } from "../src/agent/ovt-agent.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(nAgents: number) {
  const agents = Array.from({ length: nAgents }, (_, i) => {
    const id = "0:" + i.toString(16).padStart(64, "0");
    const owner = new LocalTestOwnerSigner();
    const agent = new OvtAgent(owner, { serverCmd: process.execPath, serverArgs: [], agentId: id });
    return { id, owner, agent };
  });
  const g = genesis() as Record<string, any>;
  for (const { id, owner, agent } of agents) {
    g.ptra.balances[id] = 10n ** 18n;
    g.registry.agents[id] = { granted_scopes: ["ton_transfer"], operator_pubkey: agent.operatorPubkeyHex(), owner_pubkey: owner.ownerPubkeyHex() };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr1-test-"));
  OvtNode.create(dir, g as State);
  return { agents, g: g as State, dir };
}

test("lifecycle: start → RUNNING, shutdown → STOPPED; submit gated outside live", async () => {
  const { g, dir } = setup(1);
  const d = new Pr1Daemon({ dir, genesisState: g, tickIntervalMs: 20 });
  assert.equal(d.status().state, "STOPPED");
  d.start();
  assert.equal(d.status().state, "RUNNING");
  d.shutdown();
  assert.equal(d.status().state, "STOPPED");
  assert.throws(() => d.submit({ cal: { agent_id: "x" }, trace: {} } as any), /not accepting/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("submissions finalize through ticks; post-shutdown recovery is exact", async () => {
  const { agents, dir } = setup(2);
  const d = new Pr1Daemon({ dir, genesisState: genesisOf(dir), tickIntervalMs: 20 });
  d.start();
  let n = 0;
  for (let r = 1; r <= 2; r++) for (const { agent } of agents) { d.submit(await agent.mintSubmissionFast(BigInt(r), 0n, 1_000_000n)); n++; }
  for (let i = 0; i < 100 && d.status().mempoolDepth > 0; i++) await sleep(20);
  const m = d.shutdown(); // graceful shutdown snapshots ⇒ a normal recovery has an empty tail

  // normal recovery: snapshot + (empty) tail, root exact
  const recovered = OvtNode.open(dir);
  assert.equal(recovered.stateRoot(), m.lastStateRoot, "recovery root == live root");
  assert.equal(recovered.recoveryMode(), "SNAPSHOT_TAIL", "graceful shutdown ⇒ restart restores from snapshot");
  // full-replay audit (ignore snapshots) rebuilds the COMPLETE transcript to confirm all finalized
  const audit = OvtNode.open(dir, { ignoreSnapshots: true });
  let finalized = 0;
  for (const tk of audit.getTranscript().ticks) for (const s of tk.submissions) if (s.terminalStage === "FINALIZED") finalized++;
  assert.equal(finalized, n, "every submission FINALIZED");
  assert.equal(audit.stateRoot(), m.lastStateRoot, "full-replay audit root == live root");
  assert.equal(m.totalSubmissions, n);
  fs.rmSync(dir, { recursive: true, force: true });
});

// re-read the genesis the setup persisted (so the daemon opens the same node)
function genesisOf(dir: string): State {
  return OvtNode.open(dir).getTranscript().genesisState;
}
