/**
 * PR-1.2b Gate 2 — the wired incremental path on OvtNode, with a regression guard.
 *
 * `OvtNode.submit()` must advance a carried IncrementalState by ONE tick (work O(tick)), never
 * re-fold the whole WAL from genesis (the old O(n)/tick wall). Two guards:
 *   (A) correctness — a node built tick-by-tick via submit() is byte-for-byte a node built by the
 *       one-shot bulkCreate() fold and by run() over the same blocks (every root + event log).
 *   (B) anti-regression sentinel — marginal per-submit cost stays flat as history grows. A
 *       reintroduced `run(allTicks)` in submit() would make late submits ×(history) slower; the
 *       generous bound here (a residual full re-fold over this span would be ×30+) trips long before
 *       any plausible fsync jitter does.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, type Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";

const A = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = {
  currentTick: 0n,
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  operatorSigPresent: true,
  ownerSigPresent: true,
};
function fundedGenesis(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return {
    cal: {
      action: "wallet.send_ton",
      agent_id: A,
      nonce,
      expiration_tick: 10_000_000n,
      preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
      invariants: [],
      steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
    } as Json,
    trace: okTrace,
  };
}
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-2b-${tag}-`));

test("Gate2: submit() tick-by-tick == bulkCreate() == run() (byte-for-byte)", () => {
  const g = fundedGenesis();
  const blocks = Array.from({ length: 40 }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] }));

  const dInc = tmp("inc");
  const incNode = OvtNode.create(dInc, g);
  for (let i = 0; i < blocks.length; i++) {
    const tr = incNode.submit(blocks[i]!.submissions);
    assert.equal(tr.submissions[0]!.terminalStage, "FINALIZED", `tick ${i} finalized`);
  }

  const dBulk = tmp("bulk");
  const bulkNode = OvtNode.bulkCreate(dBulk, g, blocks);
  const batch = run({ genesisState: g, ticks: blocks });

  // every observable must agree across all three construction paths
  assert.equal(incNode.stateRoot(), bulkNode.stateRoot(), "final state root: submit == bulkCreate");
  assert.equal(incNode.stateRoot(), batch.finalStateRoot, "final state root: submit == run");
  assert.equal(incNode.eventLogRoot(), bulkNode.eventLogRoot(), "event-log root: submit == bulkCreate");
  assert.deepEqual([...incNode.eventLog()], [...batch.eventLog], "event log: submit == run");
  assert.deepEqual(incNode.getTranscript().ticks, batch.ticks, "tick results: submit == run");

  // and recovery from the submit()-built WAL reproduces the same root (OVT-2 still holds)
  const reopened = OvtNode.open(dInc);
  assert.equal(reopened.stateRoot(), incNode.stateRoot(), "reopen == live root");

  for (const d of [dInc, dBulk]) fs.rmSync(d, { recursive: true, force: true });
});

test("Gate2: marginal submit() cost is flat as history grows (no re-fold regression)", () => {
  const g = fundedGenesis();
  const N = 300;
  const dir = tmp("scale");
  const node = OvtNode.create(dir, g);
  const lat: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    node.submit([sendSub(BigInt(i + 1))]);
    lat.push(performance.now() - t0);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // windowed averages dampen fsync jitter; compare an early window to a late one
  const win = (centerEnd: number) => {
    const s = lat.slice(centerEnd - 30, centerEnd);
    return s.reduce((a, b) => a + b, 0) / s.length;
  };
  const early = win(50); // submits 20..50
  const late = win(N); // submits 270..300
  const ratio = late / early;
  assert.ok(ratio < 8, `marginal submit cost grew ×${ratio.toFixed(2)} (early ${early.toFixed(2)}ms → late ${late.toFixed(2)}ms) — a residual O(n) re-fold?`);
});
