/**
 * A1-1 — long-duration soak program (accelerated, the CI code-acceptance). Composes the PR-1.9
 * SoakMonitor and adds SC-1 (duration), SC-4 (restore-equivalence), SC-6 (fd/disk). Purely evidential.
 * CI runs a short accelerated soak (real daemon + crash/restart + periodic restore checks) and asserts
 * every invariant held; the multi-day run is operational (scripts/a1-soak.mjs). Teeth: the program must
 * FLAG an injected restore mismatch, an fd leak, and a short run.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import type { Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { Pr1Daemon } from "../src/node/pr1-daemon.js";
import { LiveObserver } from "../src/node/live-observer.js";
import { SoakProgram, countOpenFds, dirBytes, type LiveRoots } from "../src/node/soak-program.js";

const A = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {} as Json, stateAfter: {} as Json, operatorSigPresent: true, ownerSigPresent: true };
function fundedGenesis(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return { cal: { action: "wallet.send_ton", agent_id: A, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] } as Json, trace: okTrace };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `a1-${tag}-`));
async function drive(d: Pr1Daemon, to: number): Promise<void> {
  for (let n = d.status().committedTicks + 1; n <= to; n++) d.submit(sendSub(BigInt(n)));
  for (let i = 0; i < 8000 && d.status().committedTicks < to; i++) await sleep(2);
  assert.equal(d.status().committedTicks, to);
}
const liveRoots = (d: Pr1Daemon): LiveRoots => {
  const o = d.metricsReport().observation;
  return { stateRoot: o.stateRoot, globalRoot: o.globalRoot, eventCount: o.eventCount, lastEventHash: o.lastEventHash, committedTicks: o.committedTicks };
};

test("A1 accelerated soak: SC-1/2/3/4/5/6 hold across a crash/restart (real daemon)", async () => {
  const N = 10;
  const dir = tmp("soak");
  OvtNode.create(dir, fundedGenesis());
  const prog = new SoakProgram({ cadence: N, alertThresholds: { driftWarnMs: 5_000, driftCritMs: 60_000 } });
  const obs = new LiveObserver();
  const sample = (d: Pr1Daemon) => {
    prog.record(d.metricsReport(), { observer: obs.observe(dir), heapBytes: process.memoryUsage().heapUsed, nowMs: Date.now() });
    prog.sampleResources({ fds: countOpenFds(), diskBytes: dirBytes(dir), heapBytes: process.memoryUsage().heapUsed, atMs: Date.now() });
  };

  let d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 25, snapshotCadence: N });
  d.start();
  await drive(d, 20); sample(d); assert.equal(prog.checkRestoreEquivalence(dir, liveRoots(d)), true, "SC-4 @20");
  await drive(d, 40); sample(d);

  d.simulateCrash(); // a long-lived system restarts — the gate must survive it
  prog.noteRestart();
  d = new Pr1Daemon({ dir, genesisState: fundedGenesis(), tickIntervalMs: 25, snapshotCadence: N });
  d.start();
  await drive(d, 60); sample(d); assert.equal(prog.checkRestoreEquivalence(dir, liveRoots(d)), true, "SC-4 @60 (post-restart)");
  d.shutdown();

  const rep = prog.report();
  assert.equal(rep.ok, true, `soak PASSED (violations: ${JSON.stringify([...rep.base.violations, ...rep.a1Violations])})`);
  assert.equal(rep.base.restarts, 1, "exercised a restart");
  assert.ok(rep.restoreChecks >= 2, "SC-4 sampled throughout");
  assert.ok(rep.resource.samples >= 3, "SC-6 resource samples taken");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("teeth SC-4: an injected restore mismatch is flagged (durability)", () => {
  const dir = tmp("teeth4");
  const node = OvtNode.create(dir, fundedGenesis());
  for (let i = 0; i < 15; i++) { node.submit([sendSub(BigInt(i + 1))]); node.maybeSnapshot(10); }
  const prog = new SoakProgram();
  const wrong: LiveRoots = { ...liveRootsFromNode(node), stateRoot: "0x" + "ff".repeat(32) };
  assert.equal(prog.checkRestoreEquivalence(dir, wrong), false);
  const rep = prog.report();
  assert.equal(rep.ok, false);
  assert.ok(rep.a1Violations.some((v) => v.class === "durability"), "durability violation recorded");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("teeth SC-6: a sustained fd rate is flagged (resource leak)", () => {
  const prog = new SoakProgram({ fdRateCeilPerSec: 0.5 });
  prog.sampleResources({ fds: 20, diskBytes: 1000, heapBytes: 1000, atMs: 0 });
  prog.sampleResources({ fds: 120, diskBytes: 1000, heapBytes: 1000, atMs: 1000 }); // +100 fds / 1s
  const rep = prog.report();
  assert.equal(rep.ok, false);
  assert.ok(rep.a1Violations.some((v) => v.class === "resource" && /fd growth/.test(v.detail)), "fd leak flagged");
});

test("teeth SC-1: a run shorter than the target window is flagged (duration)", () => {
  const prog = new SoakProgram({ targetDurationMs: 7 * 24 * 3600 * 1000 }); // 7-day target
  prog.sampleResources({ fds: 10, diskBytes: 1000, heapBytes: 1000, atMs: 0 });
  prog.sampleResources({ fds: 10, diskBytes: 1000, heapBytes: 1000, atMs: 1000 });
  const rep = prog.report();
  assert.equal(rep.ok, false);
  assert.ok(rep.a1Violations.some((v) => v.class === "duration"), "short run flagged");
  assert.equal(rep.durationMet, false);
});

// helper: roots straight from an OvtNode (for the teeth test)
function liveRootsFromNode(n: OvtNode): LiveRoots {
  const o = n.observe();
  return { stateRoot: o.stateRoot, globalRoot: o.globalRoot, eventCount: o.eventCount, lastEventHash: o.lastEventHash, committedTicks: o.committedTicks };
}
