/**
 * PR-1.2b Gate 1 — the central post-freeze invariant.
 *
 * Introducing `applyTick` + a maintained `IncrementalState` creates a SECOND path to the
 * same state (incremental, tick-by-tick — the daemon path) alongside the proven batch
 * fold. The risk is not in snapshots or recovery; it is here: that the incremental path
 * diverges from `run(history)`. This suite proves it does not — byte-for-byte on every
 * root, the carried (eventCount, lastEventHash), and the derived event log — over the
 * whole OVT corpus, with two NON-tautological oracles so "run == fold(applyTick)" is not
 * proved by construction alone:
 *
 *   (2) carried-scalar global root  ==  global root independently recomputed from the
 *       fully-materialised event log (the pre-PR-1.2b formula). Guards exactly the
 *       "STATE_ROOT matched but last_event_hash diverged" class.
 *   (3) folding a program as two halves, resuming the second half from the carried
 *       accumulator, == folding it whole. Guards that IncrementalState is self-contained
 *       (carries currentTick / counters); a missing field would diverge here.
 *
 * (Batch-vs-NORMATIVE-golden is anchored separately in golden-vectors.test.ts.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { eventHash } from "@paradigm-terra/cal";
import { genesis, stateRootOf, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { streamTreeRoot, toHex, type StreamLeaf } from "@paradigm-terra/canonical";
import { applyTick, initIncremental, run, type Event, type Program } from "../src/index.js";
import { PROGRAMS } from "../scripts/programs.js";

const hex = (b: Uint8Array): string => `0x${toHex(b)}`;
const ZERO32 = new Uint8Array(32);

// ---- a long single-agent program: stress the carry over a deep history ------------------
const LA = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = {
  currentTick: 0n,
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  operatorSigPresent: true,
  ownerSigPresent: true,
};
function fundedGenesis(agent: string, bal: bigint): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[agent] = bal;
  g.registry.agents[agent] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendCal(agent: string, nonce: bigint): Json {
  return {
    action: "wallet.send_ton",
    agent_id: agent,
    nonce,
    expiration_tick: 1_000_000n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${agent}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
  } as Json;
}
function longProgram(ticks: number): Program {
  const blocks = Array.from({ length: ticks }, (_, i) => ({
    tick: BigInt(i),
    submissions: [{ cal: sendCal(LA, BigInt(i)), trace: okTrace }],
  }));
  return { genesisState: fundedGenesis(LA, 10n ** 18n), ticks: blocks };
}

const CORPUS: ReadonlyArray<{ id: string; program: Program }> = [
  ...PROGRAMS.map((p) => ({ id: p.id, program: p.program })),
  { id: "long-150-single-agent", program: longProgram(150) },
];

// INDEPENDENT oracle for the CE §6.3 global root: recompute from a fully-materialised
// event log (the pre-PR-1.2b inputs), NOT from the carried scalars.
function globalRootFromLog(state: State, log: readonly Event[]): string {
  const last = log[log.length - 1];
  const leaf: StreamLeaf = {
    streamId: "global",
    stateHash: stateRootOf(state),
    lastEventHash: last ? eventHash(last) : ZERO32,
    lastSeqno: BigInt(log.length),
  };
  return hex(streamTreeRoot([leaf]));
}

test("Gate1: incremental tick-by-tick == batch run() over the OVT corpus", () => {
  for (const { id, program } of CORPUS) {
    const batch = run(program);

    // The daemon path: carry IncrementalState across ticks; never re-fold history.
    let incr = initIncremental(program.genesisState);
    const incrLog: Event[] = [];
    for (let k = 0; k < program.ticks.length; k++) {
      const step = applyTick(incr, program.ticks[k]!);
      incr = step.next;
      for (const e of step.events) incrLog.push(e);
      // every field of the tick result is byte-for-byte the batch result
      assert.deepEqual(step.tickResult, batch.ticks[k], `${id} tick[${k}]: tickResult`);
    }

    assert.equal(incr.eventCount, batch.eventLog.length, `${id}: carried eventCount == log length`);
    const lastHash = batch.eventLog.length ? hex(eventHash(batch.eventLog[batch.eventLog.length - 1]!)) : hex(ZERO32);
    assert.equal(hex(incr.lastEventHash), lastHash, `${id}: carried lastEventHash == hash of last event`);
    assert.equal(hex(stateRootOf(incr.state)), batch.finalStateRoot, `${id}: final STATE_ROOT`);
    assert.deepEqual(incrLog, [...batch.eventLog], `${id}: derived event log`);
  }
});

test("Gate1: carried-scalar global root == root recomputed from the full event log", () => {
  // The non-tautological carry guard: applyTick builds globalMerkleRoot from the carried
  // (eventCount, lastEventHash); here we rebuild it from the materialised log, a different
  // formula over different inputs. Disagreement => the carry seam diverged.
  for (const { id, program } of CORPUS) {
    let incr = initIncremental(program.genesisState);
    const log: Event[] = [];
    for (let k = 0; k < program.ticks.length; k++) {
      const step = applyTick(incr, program.ticks[k]!);
      incr = step.next;
      for (const e of step.events) log.push(e);
      const independent = globalRootFromLog(incr.state, log);
      assert.equal(step.tickResult.globalMerkleRoot, independent, `${id} tick[${k}]: global root carry-vs-log`);
    }
  }
});

test("Gate1: split/resume from the carried accumulator == whole-program batch", () => {
  // Self-containment of IncrementalState: stop after every prefix, resume the suffix from
  // only the carried accumulator, and require the joined transcript to equal the whole run.
  for (const { id, program } of CORPUS) {
    const whole = run(program);
    const n = program.ticks.length;
    for (const splitAt of [0, 1, Math.floor(n / 2), n - 1, n].filter((s) => s >= 0 && s <= n)) {
      let incr = initIncremental(program.genesisState);
      const ticks: unknown[] = [];
      const log: Event[] = [];
      for (let k = 0; k < n; k++) {
        // crossing the split, the resumed half gets ONLY a round-tripped copy of the
        // accumulator — no history, no log, no live references. If the carry were
        // incomplete (or unserialisable, which 1.2c snapshots depend on) this diverges.
        if (k === splitAt) incr = structuredClone(incr);
        const step = applyTick(incr, program.ticks[k]!);
        incr = step.next;
        ticks.push(step.tickResult);
        for (const e of step.events) log.push(e);
      }
      assert.deepEqual(ticks, [...whole.ticks], `${id} split@${splitAt}: ticks`);
      assert.equal(hex(stateRootOf(incr.state)), whole.finalStateRoot, `${id} split@${splitAt}: final root`);
      assert.deepEqual(log, [...whole.eventLog], `${id} split@${splitAt}: event log`);
    }
  }
});
