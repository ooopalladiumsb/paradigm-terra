/**
 * Shared golden programs — the single source of truth for both the vector generator
 * and the golden-vectors test. Each program exercises a slice of the node's contract:
 * multi-agent / multi-tick finalization, the failure classes, and expiration.
 */

import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import type { Program, Submission } from "../src/index.js";

export const A = "0:" + "aa".repeat(32);
export const B = "0:" + "bb".repeat(32);
const FUND = 10n ** 18n;

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
  currentTick: 0n, // the node overrides this with its own tick
  steps: [{ ok: true, effects: [] }],
  stateBefore: {} as Json,
  stateAfter: {} as Json,
  ownerSigPresent: true,
};

function sub(agent: string, nonce: bigint, over: Record<string, Json> = {}): Submission {
  return { cal: mkCal(agent, nonce, over), trace: okTrace };
}

const FALSE_PRECOND: Record<string, Json> = { preconditions: { op: "gte", lhs: { const: 0n }, rhs: { const: 1n } } };

export interface GoldenProgram {
  readonly id: string;
  readonly description: string;
  readonly program: Program;
}

export const PROGRAMS: readonly GoldenProgram[] = [
  {
    id: "multi_agent_multi_tick_happy",
    description: "A and B each finalize at tick 0; A finalizes again (nonce 2) at tick 2 — nonce streams independent, ticks advance",
    program: {
      genesisState: start({ id: A, balance: FUND }, { id: B, balance: FUND }),
      ticks: [
        { tick: 0n, submissions: [sub(A, 1n), sub(B, 1n)] },
        { tick: 2n, submissions: [sub(A, 2n)] },
      ],
    },
  },
  {
    id: "failure_classes",
    description: "PRECOND_FALSE (spam charge, burns nonce 1) → valid finalize (nonce 2) → NONCE_MISMATCH (stale nonce 5)",
    program: {
      genesisState: start({ id: A, balance: FUND }),
      ticks: [
        {
          tick: 0n,
          submissions: [sub(A, 1n, FALSE_PRECOND), sub(A, 2n), sub(A, 5n)],
        },
      ],
    },
  },
  {
    id: "expiration_pre_validated",
    description: "finalize at tick 0, then at tick 10 a CAL whose expiration_tick=3 is rejected EXPIRED before VALIDATED",
    program: {
      genesisState: start({ id: A, balance: FUND }),
      ticks: [
        { tick: 0n, submissions: [sub(A, 1n)] },
        { tick: 10n, submissions: [sub(A, 2n, { expiration_tick: 3n })] },
      ],
    },
  },
];
