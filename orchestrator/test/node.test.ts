/**
 * Behavioural checks for the node: multi-CAL nonce progression (§6.2), multi-agent
 * independence, multi-tick advancement + EXPIRED_PRE, the global Merkle root, and
 * replay-determinism (§7.2). Golden roots are pinned separately in golden-vectors.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, replay, verifyReplay, type Program, type Submission } from "../src/index.js";

const A = "0:" + "aa".repeat(32);
const B = "0:" + "bb".repeat(32);

function start(...agents: { id: string; balance: bigint; scopes?: string[] }[]): State {
  const g = genesis() as unknown as {
    ptra: { balances: Record<string, Json> };
    registry: { agents: Record<string, Json> };
  };
  for (const a of agents) {
    g.ptra.balances[a.id] = a.balance;
    g.registry.agents[a.id] = { granted_scopes: a.scopes ?? ["ton_transfer"] };
  }
  return g as unknown as State;
}

function mkCal(agent: string, nonce: bigint, over: Record<string, Json> = {}): Json {
  return {
    action: "wallet.send_ton",
    agent_id: agent,
    nonce,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${agent}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
    ...over,
  } as Json;
}

const okTrace: ExecutionTrace = {
  currentTick: 0n, // overridden by the node
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  ownerSigPresent: true,
};

function sub(agent: string, nonce: bigint, over: Record<string, Json> = {}): Submission {
  return { cal: mkCal(agent, nonce, over), trace: okTrace };
}

const FUND = 10n ** 18n;

test("single CAL → FINALIZED with full ingress+lifecycle event sequence", () => {
  const program: Program = { genesisState: start({ id: A, balance: FUND }), ticks: [{ tick: 0n, submissions: [sub(A, 1n)] }] };
  const t = run(program);
  const s = t.ticks[0]!.submissions[0]!;
  assert.equal(s.terminalStage, "FINALIZED");
  assert.equal(s.reasonCode, null);
  assert.deepEqual(
    s.events.map((e) => e["event_type"]),
    ["cal.created", "cal.signed", "cal.validated", "cal.executed", "cal.settled", "cal.finalized"],
  );
  assert.equal(s.stateRoots.length, s.events.length);
  assert.ok(verifyReplay(t));
});

test("two CALs from one agent: nonce progresses 1→2, both FINALIZE", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }),
    ticks: [{ tick: 0n, submissions: [sub(A, 1n), sub(A, 2n)] }],
  };
  const t = run(program);
  const [s1, s2] = t.ticks[0]!.submissions;
  assert.equal(s1!.terminalStage, "FINALIZED");
  assert.equal(s2!.terminalStage, "FINALIZED");
  assert.ok(verifyReplay(t));
});

test("stale nonce → NONCE_MISMATCH, no cal.validated emitted", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }),
    ticks: [{ tick: 0n, submissions: [sub(A, 2n)] }], // expects nonce 1
  };
  const t = run(program);
  const s = t.ticks[0]!.submissions[0]!;
  assert.equal(s.terminalStage, "FAILED");
  assert.equal(s.reasonCode, "NONCE_MISMATCH");
  assert.ok(!s.events.some((e) => e["event_type"] === "cal.validated"));
});

test("two agents in one tick are independent (each nonce 1 finalizes)", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }, { id: B, balance: FUND }),
    ticks: [{ tick: 0n, submissions: [sub(A, 1n), sub(B, 1n)] }],
  };
  const t = run(program);
  for (const s of t.ticks[0]!.submissions) assert.equal(s.terminalStage, "FINALIZED");
});

test("multi-tick: tick.advanced is emitted; a CAL past its expiration at a later tick → EXPIRED", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }),
    ticks: [
      { tick: 0n, submissions: [sub(A, 1n)] },
      { tick: 5n, submissions: [sub(A, 2n, { expiration_tick: 3n })] }, // tick 5 > expiration 3
    ],
  };
  const t = run(program);
  assert.equal(t.ticks.length, 2);
  assert.equal(t.ticks[0]!.tick, 0n);
  assert.equal(t.ticks[1]!.tick, 5n);
  assert.ok(t.eventLog.some((e) => e["event_type"] === "tick.advanced" && e["new_tick"] === 5n));
  const late = t.ticks[1]!.submissions[0]!;
  assert.equal(late.terminalStage, "EXPIRED");
  assert.ok(verifyReplay(t));
});

test("PRECOND_FALSE → FAILED (pre-VALIDATED spam charge), no cal.validated", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }),
    ticks: [{ tick: 0n, submissions: [sub(A, 1n, { preconditions: { op: "gte", lhs: { const: 0n }, rhs: { const: 1n } } })] }],
  };
  const t = run(program);
  const s = t.ticks[0]!.submissions[0]!;
  assert.equal(s.terminalStage, "FAILED");
  assert.equal(s.reasonCode, "PRECOND_FALSE");
  assert.ok(!s.events.some((e) => e["event_type"] === "cal.validated"));
  assert.ok(s.events.some((e) => e["event_type"] === "cal.failed"));
});

test("global Merkle root is present, 32-byte, and evolves across ticks", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }),
    ticks: [
      { tick: 0n, submissions: [sub(A, 1n)] },
      { tick: 1n, submissions: [sub(A, 2n)] },
    ],
  };
  const t = run(program);
  const r0 = t.ticks[0]!.globalMerkleRoot;
  const r1 = t.ticks[1]!.globalMerkleRoot;
  assert.match(r0, /^0x[0-9a-f]{64}$/);
  assert.match(r1, /^0x[0-9a-f]{64}$/);
  assert.notEqual(r0, r1);
});

test("replay of the event log reproduces the final STATE_ROOT exactly", () => {
  const program: Program = {
    genesisState: start({ id: A, balance: FUND }, { id: B, balance: FUND }),
    ticks: [
      { tick: 0n, submissions: [sub(A, 1n), sub(B, 1n)] },
      { tick: 2n, submissions: [sub(A, 2n)] },
    ],
  };
  const t = run(program);
  const r = replay(t.eventLog, program.genesisState);
  assert.equal(r.error, undefined);
  assert.equal(r.finalStateRoot, t.finalStateRoot);
});
