/**
 * PR-1.2c-B Gate B — the central recovery invariant.
 *
 *   full_replay(WAL)  ==  restore(snapshot@covered_tick) + replay_tail(WAL after covered_tick)
 *
 * proven for EVERY admissible cut-point (covered_tick = 0, 1, middle, last-1, final) over the whole
 * OVT corpus — the snapshot analogue of PR-1.2b's split/resume. Equality is byte-for-byte on the five
 * quantities the design fixed:
 *
 *   STATE_ROOT   GLOBAL_ROOT   EVENT_COUNT   LAST_EVENT_HASH   COVERED_TICK
 *
 * The snapshot is round-tripped through the REAL codec (encode∘decode) at each cut, so a recovery-path
 * regression in the $bytes handling of lastEventHash would surface here too.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { toHex } from "@paradigm-terra/canonical";
import { applyTick, incrementalGlobalRoot, incrementalStateRoot, initIncremental, type IncrementalState, type Program, type Submission, type TickBlock } from "../src/index.js";
import { decodeSnapshot, encodeSnapshot, makeSnapshotBody } from "../src/node/snapshot.js";
import { PROGRAMS } from "../scripts/programs.js";

// ---- a long single-agent program (deep history → many cut-points) -----------------------------
const LA = "0:" + "cc".repeat(32);
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
  g.ptra.balances[LA] = 10n ** 18n;
  g.registry.agents[LA] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return {
    cal: {
      action: "wallet.send_ton",
      agent_id: LA,
      nonce,
      expiration_tick: 10_000_000n,
      preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${LA}` }, rhs: { const: 1n } },
      invariants: [],
      steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
    } as Json,
    trace: okTrace,
  };
}
function longProgram(ticks: number): Program {
  return { genesisState: fundedGenesis(), ticks: Array.from({ length: ticks }, (_, i) => ({ tick: BigInt(i), submissions: [sendSub(BigInt(i + 1))] })) };
}

const CORPUS: ReadonlyArray<{ id: string; program: Program }> = [
  ...PROGRAMS.map((p) => ({ id: p.id, program: p.program })),
  { id: "long-60-single-agent", program: longProgram(60) },
];

const five = (incr: IncrementalState) => ({
  stateRoot: incrementalStateRoot(incr),
  globalRoot: incrementalGlobalRoot(incr),
  eventCount: incr.eventCount,
  lastEventHash: toHex(incr.lastEventHash),
});

/** Fold `blocks` onto a starting live state (the same applyTick fold the node uses). */
function foldOnto(start: IncrementalState, blocks: readonly TickBlock[]): IncrementalState {
  let incr = start;
  for (const b of blocks) incr = applyTick(incr, b).next;
  return incr;
}

test("GateB: restore(snapshot@k) + tail == full_replay for every cut-point, all 5 quantities", () => {
  for (const { id, program } of CORPUS) {
    const blocks = program.ticks as readonly TickBlock[];
    const n = blocks.length;
    const g = program.genesisState as State;

    // reference: the full re-fold from genesis
    const full = foldOnto(initIncremental(g), blocks);
    const ref = five(full);

    const cuts = [...new Set([0, 1, Math.floor(n / 2), Math.max(0, n - 1), n].filter((k) => k >= 0 && k <= n))];
    for (const k of cuts) {
      // snapshot the state after folding the first k blocks, persist + reload via the REAL codec
      const snapIncr = foldOnto(initIncremental(g), blocks.slice(0, k));
      const decoded = decodeSnapshot(encodeSnapshot(makeSnapshotBody(snapIncr, BigInt(k), 0n)));
      assert.equal(decoded.covered_tick, BigInt(k), `${id} cut@${k}: covered_tick round-trips`);

      // restore + replay the tail
      const restored = foldOnto(decoded.incr, blocks.slice(k));
      const got = five(restored);

      assert.equal(got.stateRoot, ref.stateRoot, `${id} cut@${k}: STATE_ROOT`);
      assert.equal(got.globalRoot, ref.globalRoot, `${id} cut@${k}: GLOBAL_ROOT`);
      assert.equal(got.eventCount, ref.eventCount, `${id} cut@${k}: EVENT_COUNT`);
      assert.equal(got.lastEventHash, ref.lastEventHash, `${id} cut@${k}: LAST_EVENT_HASH (byte-for-byte)`);
    }
  }
});
