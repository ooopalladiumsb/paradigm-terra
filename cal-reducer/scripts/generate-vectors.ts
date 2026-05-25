/**
 * Generate golden vectors for @paradigm-terra/cal-reducer v0.1.0.
 *
 * Pins: the genesis STATE_ROOT; for each (start state, event sequence) the
 * STATE_ROOT after every event; and for each error case the ApplyError code.
 * States and events are stored as canonical-JSON text so the Rust/Go parity
 * ports re-parse them identically. Promote PRE-NORMATIVE → NORMATIVE once both
 * reproduce every root and code byte-for-byte.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical, toHex, type JcsValue } from "@paradigm-terra/canonical";
import { apply, genesis, scanStateRoots, stateRootOf, type Json, type State } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "golden.json");

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const CH = `0x${"11".repeat(32)}`;
const CH2 = `0x${"22".repeat(32)}`;
const hex = (b: Uint8Array) => `0x${toHex(b)}`;

function funded(addr: string, amount: bigint): State {
  const g = genesis();
  (g.ptra as { balances: Record<string, Json> }).balances[addr] = amount;
  return g;
}

type Ev = { [k: string]: Json };

// ---- happy path: one CAL through FINALIZED, one through FAILED, then a tick ----
const happyStart = funded(A, 1_000_000n);
const happyEvents: Ev[] = [
  { event_type: "cal.created", cal_hash: CH, agent_id: A },
  { event_type: "cal.signed", cal_hash: CH },
  { event_type: "cal.validated", cal_hash: CH, fee_debited_ptra: 100_000n },
  { event_type: "cal.executed", cal_hash: CH, gas_consumed_ptra: 200_000n, effects: [{ ns: "treasury", op: "add", path: ["nav"], value: 1_000n }] },
  { event_type: "cal.settled", cal_hash: CH },
  { event_type: "cal.finalized", cal_hash: CH, gas_refunded_ptra: 50_000n },
  { event_type: "cal.created", cal_hash: CH2, agent_id: A },
  { event_type: "cal.signed", cal_hash: CH2 },
  { event_type: "cal.validated", cal_hash: CH2, fee_debited_ptra: 100_000n },
  { event_type: "cal.executed", cal_hash: CH2, gas_consumed_ptra: 50_000n, effects: [{ ns: "treasury", op: "add", path: ["nav"], value: 9_999n }] },
  { event_type: "cal.failed", cal_hash: CH2 },
  { event_type: "tick.advanced", new_tick: 5n },
];

// ---- bounded-mode flip via the capture-guard counter trigger ----
const boundedStart: State = (() => {
  const g = genesis();
  (g.governance as { params: Record<string, Json> }).params.capture_guard_threshold = 3n;
  (g.failure_mode as { capture_guard_counters: Record<string, Json> }).capture_guard_counters.cluster1 = 3n;
  return g;
})();
const boundedEvents: Ev[] = [{ event_type: "tick.advanced", new_tick: 1n }];

// ---- external mirroring + shadow init ----
const mirrorStart = funded(A, 500n);
const mirrorEvents: Ev[] = [
  { event_type: "ptra.shadow_init", addr: CH /* arbitrary fresh addr-like key */ },
  { event_type: "ptra.transferred", from: A, to: CH, amount_nano_ptra: 200n },
  { event_type: "oracle.feed_submitted", symbol: "TON/USD", value: 530n },
];

interface SeqVector {
  id: string;
  description: string;
  start_state_canonical: string;
  events: string[];
  expected_roots: string[];
}

function seq(id: string, description: string, start: State, events: Ev[]): SeqVector {
  const scan = scanStateRoots(events, start);
  if (scan.error) throw new Error(`${id}: unexpected ApplyError ${scan.error.code} at ${scan.error.index}`);
  return {
    id,
    description,
    start_state_canonical: serializeCanonical(start as JcsValue),
    events: events.map((e) => serializeCanonical(e as JcsValue)),
    expected_roots: scan.roots,
  };
}

const sequences = [
  seq("happy_then_failed_then_tick", "CAL→FINALIZED (commit staged), CAL→FAILED (discard staged), then tick", happyStart, happyEvents),
  seq("bounded_mode_flip", "tick.advanced recomputes is_bounded_mode=true via capture-guard counter", boundedStart, boundedEvents),
  seq("mirror_and_shadow", "shadow_init, ptra.transferred, oracle.feed_submitted", mirrorStart, mirrorEvents),
];

// ---- error cases ----
function inFlightState(stage: string): State {
  const g = funded(A, 0n);
  (g.cal as { in_flight: Record<string, Json> }).in_flight[CH] = {
    agent_id: A,
    stage,
    fee_debited_ptra: 0n,
    gas_consumed_ptra: 0n,
    staged: [],
  };
  return g;
}

interface ErrVector {
  id: string;
  description: string;
  start_state_canonical: string;
  event_canonical: string;
  expected_error_code: string;
}

function errVec(id: string, description: string, start: State, event: Ev, code: string): ErrVector {
  const res = apply(start, event);
  if (res.ok) throw new Error(`${id}: expected ApplyError but apply succeeded`);
  if (res.code !== code) throw new Error(`${id}: expected ${code}, got ${res.code}`);
  return { id, description, start_state_canonical: serializeCanonical(start as JcsValue), event_canonical: serializeCanonical(event as JcsValue), expected_error_code: code };
}

const errors = [
  errVec("unknown_cal", "cal.signed for a hash not in_flight", genesis(), { event_type: "cal.signed", cal_hash: CH }, "UNKNOWN_CAL"),
  errVec("agent_busy", "cal.created while the agent already has an in-flight CAL", inFlightState("CREATED"), { event_type: "cal.created", cal_hash: CH2, agent_id: A }, "AGENT_BUSY"),
  errVec("bad_stage", "cal.validated on a CREATED (not SIGNED) CAL", inFlightState("CREATED"), { event_type: "cal.validated", cal_hash: CH, fee_debited_ptra: 1n }, "BAD_STAGE"),
  errVec("insufficient_balance", "cal.validated debits more PTRA than the agent holds", inFlightState("SIGNED"), { event_type: "cal.validated", cal_hash: CH, fee_debited_ptra: 100n }, "INSUFFICIENT_BALANCE"),
  errVec("unknown_event", "an unrecognized event_type", genesis(), { event_type: "frobnicate" }, "UNKNOWN_EVENT"),
  errVec("bad_tick", "tick.advanced that does not advance", genesis(), { event_type: "tick.advanced", new_tick: 0n }, "BAD_TICK"),
];

const doc = {
  meta: {
    package: "@paradigm-terra/cal-reducer",
    version: "0.1.0",
    spec_basis: "CAL Execution Specification v0.1.0-draft §7.1 — deterministic event reducer (apply, per-CAL staging)",
    generated_at: new Date().toISOString(),
    status:
      "PRE-NORMATIVE — generated by the TypeScript reference implementation. Promote to NORMATIVE once the Rust (cal-reducer-rs) and Go (cal-reducer-go) parity implementations reproduce every STATE_ROOT and ApplyError code byte-for-byte.",
  },
  genesis_state_root: hex(stateRootOf(genesis())),
  sequences,
  errors,
};

await writeFile(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`Wrote genesis root + ${sequences.length} sequences + ${errors.length} error cases to ${OUTPUT_PATH}`);
