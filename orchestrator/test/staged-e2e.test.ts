/**
 * Gate #3 end-to-end: the multi-tick staging driver makes the two previously-unreachable
 * terminal states reachable through real orchestration.
 *   AGENT_BUSY   — a CAL left in-flight at VALIDATED (validate-only) blocks a second CAL
 *                  for the same agent (reducer §6.1).
 *   EXPIRED_POST — a VALIDATED CAL resumed at a tick past expiration_tick.
 * Reachability layer only: no new business logic; validate()'s atomic path is untouched.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, type Program, type Submission } from "../src/index.js";

const A = "0:" + "aa".repeat(32);
const FUND = 10n ** 18n;

function start(): State {
  const g = genesis() as unknown as {
    ptra: { balances: Record<string, Json> };
    registry: { agents: Record<string, Json> };
  };
  g.ptra.balances[A] = FUND;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function mkCal(nonce: bigint, expiration: bigint): Json {
  return {
    action: "wallet.send_ton",
    agent_id: A,
    nonce,
    expiration_tick: expiration,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
  } as Json;
}
const okTrace: ExecutionTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {} as Json, stateAfter: {} as Json, operatorSigPresent: true, ownerSigPresent: true };
const sub = (cal: Json, mode?: Submission["mode"]): Submission => ({ cal, trace: okTrace, mode });
const types = (es: readonly Json[]) => es.map((e) => (e as Record<string, Json>)["event_type"]);

test("AGENT_BUSY e2e: validate-only leaves CAL_A in-flight; CAL_B (same agent) is rejected", () => {
  const prog: Program = {
    genesisState: start(),
    ticks: [{ tick: 0n, submissions: [sub(mkCal(1n, 100n), "validate-only"), sub(mkCal(2n, 100n), "atomic")] }],
  };
  const t = run(prog);
  const [a, b] = t.ticks[0]!.submissions;
  assert.equal(a!.terminalStage, null, "CAL_A staged-pending (in-flight at VALIDATED)");
  assert.deepEqual(types(a!.events), ["cal.created", "cal.signed", "cal.validated"]);
  assert.equal(b!.ingressError?.code, "AGENT_BUSY", "CAL_B rejected while CAL_A in-flight");
});

test("EXPIRED_POST e2e: VALIDATED at T0, resumed at tick > expiration_tick", () => {
  const prog: Program = {
    genesisState: start(),
    ticks: [
      { tick: 0n, submissions: [sub(mkCal(1n, 5n), "validate-only")] },
      { tick: 10n, submissions: [sub(mkCal(1n, 5n), "resume")] },
    ],
  };
  const t = run(prog);
  const s0 = t.ticks[0]!.submissions[0]!;
  const s1 = t.ticks[1]!.submissions[0]!;
  assert.equal(s0.terminalStage, null);
  assert.deepEqual(types(s0.events), ["cal.created", "cal.signed", "cal.validated"]);
  assert.equal(s1.terminalStage, "EXPIRED", "resume past expiration → EXPIRED_POST");
  assert.deepEqual(types(s1.events), ["cal.expired"]);
});

test("control: resumed before expiration → FINALIZED (staging is faithful, not lossy)", () => {
  const prog: Program = {
    genesisState: start(),
    ticks: [
      { tick: 0n, submissions: [sub(mkCal(1n, 100n), "validate-only")] },
      { tick: 1n, submissions: [sub(mkCal(1n, 100n), "resume")] },
    ],
  };
  const t = run(prog);
  const s1 = t.ticks[1]!.submissions[0]!;
  assert.equal(s1.terminalStage, "FINALIZED");
  assert.deepEqual(types(s1.events), ["cal.executed", "cal.settled", "cal.finalized"]);
});
