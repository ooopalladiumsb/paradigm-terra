/**
 * The deterministic node / orchestrator (CAL Exec Spec §6 serialization, §7
 * reducer & state root, Canonical Encoding v1.3 §6.3 global Merkle root).
 *
 * A node folds a *program* — an ordered list of per-tick blocks, each carrying a
 * list of `{cal, trace}` submissions — through the full pipeline over one evolving
 * `State`:
 *
 *   for each submission:  cal.created -> cal.signed   (ingress; the reducer enforces
 *                         §6.1 single-in-flight-per-agent and CAL uniqueness)
 *                         validate(cal, snapshot=State, trace) -> lifecycle events
 *                         fold every event through apply() to advance State
 *
 * Between blocks it emits `tick.advanced`, so a CAL submitted at a later tick than
 * its `expiration_tick` is rejected EXPIRED_PRE, and the bounded-mode counter is
 * recomputed (§10.1). It records the STATE_ROOT after every event and the global
 * stream Merkle root (CE §6.3) at the end of each tick, and the whole event log is
 * byte-for-byte replayable (see `replay`).
 *
 * Pure: like the validator it consumes execution traces and does not execute steps.
 *
 * Scope note: `validate()` is atomic (one `currentTick` per call), so the
 * post-VALIDATED expiration re-checks (EXPIRED_POST) and AGENT_BUSY remain defensive
 * — reaching them needs a staged validator (validate-to-VALIDATED at T0, execute at
 * a later tick). That is the next increment; this node exercises everything the
 * atomic model can express.
 */

import { calHash, eventHash } from "@paradigm-terra/cal";
import { apply, genesis, scanStateRoots, stateRootOf, type Json, type State } from "@paradigm-terra/cal-reducer";
import { validate, validateToValidated, resumeFromValidated, type ExecutionTrace, type Json as VJson } from "@paradigm-terra/cal-validator";
import { streamTreeRoot, toHex, type StreamLeaf } from "@paradigm-terra/canonical";

export class OrchestratorError extends Error {
  constructor(
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "OrchestratorError";
  }
}

export type Event = { [k: string]: Json };
export type TerminalStage = "FINALIZED" | "FAILED" | "EXPIRED";

/** One CAL handed to the node together with the off-chain executor's observed trace. */
export interface Submission {
  /** The CAL payload (canonical object: action, agent_id, nonce, expiration_tick, …). */
  readonly cal: Json;
  /** Validators do not execute — the step outcomes / before-after state arrive here (§4.1). */
  readonly trace: ExecutionTrace;
  /**
   * Lifecycle staging (Gate #3, reachability only — no new business logic):
   * - `"atomic"` (default): created→signed→validate()→terminal in one tick.
   * - `"validate-only"`: created→signed→validateToValidated(); leaves the CAL in-flight at
   *   VALIDATED (so a later-tick resume can hit EXPIRED_POST, or a same-agent CAL hits AGENT_BUSY).
   * - `"resume"`: no ingress events; resumeFromValidated() drives an already-in-flight VALIDATED CAL
   *   to its terminal (EXPIRED_POST when currentTick > expiration_tick).
   */
  readonly mode?: "atomic" | "validate-only" | "resume";
}

/** All submissions that land at one tick. */
export interface TickBlock {
  /** The tick this block runs at; must be ≥ the node's current tick (non-decreasing). */
  readonly tick: bigint;
  readonly submissions: readonly Submission[];
}

export interface Program {
  /** Defaults to the reducer genesis. */
  readonly genesisState?: State;
  readonly ticks: readonly TickBlock[];
}

export interface SubmissionResult {
  readonly calHash: string;
  readonly agentId: string;
  /** null when rejected at ingress (cal.created/cal.signed) before validation. */
  readonly terminalStage: TerminalStage | null;
  readonly reasonCode: string | null;
  /** Ingress (cal.created/cal.signed) + the validator's lifecycle events, in order. */
  readonly events: readonly Event[];
  /** STATE_ROOT (hex) after each of `events`. */
  readonly stateRoots: readonly string[];
  /** Present when the reducer rejected an ingress event (e.g. AGENT_BUSY, DUPLICATE_CAL). */
  readonly ingressError?: { readonly code: string };
}

export interface TickResult {
  readonly tick: bigint;
  readonly submissions: readonly SubmissionResult[];
  /** STATE_ROOT (hex) at the end of the tick. */
  readonly stateRoot: string;
  /** CE §6.3 global stream Merkle root (hex) at the end of the tick. */
  readonly globalMerkleRoot: string;
}

export interface Transcript {
  /** The start state the run folded from — needed to replay the log faithfully. */
  readonly genesisState: State;
  readonly ticks: readonly TickResult[];
  /** The full ordered event log — fold it from `genesisState` to reproduce every root (see `replay`). */
  readonly eventLog: readonly Event[];
  readonly finalStateRoot: string;
}

const hex = (b: Uint8Array): string => `0x${toHex(b)}`;
const ZERO32 = new Uint8Array(32);

function strField(obj: Json, key: string): string {
  const v = (obj as { [k: string]: Json } | null)?.[key];
  if (typeof v !== "string") throw new OrchestratorError("BAD_CAL", `${key} must be a string`);
  return v;
}

function currentTickOf(state: State): bigint {
  const v = (state as { tick?: { current?: Json } }).tick?.current;
  return typeof v === "bigint" ? v : 0n;
}

/**
 * CE §6.3 global Merkle root. v0.1.0 models the node as one canonical stream
 * (`"global"`) over its single reducer State; the constitution's fixed multi-stream
 * list (CE §6.2) drops in here later by emitting one leaf per stream.
 *
 * Built from the *carried* cumulative `(eventCount, lastEventHash)` rather than from a
 * full event-log array: `lastSeqno = eventCount` (= log length) and `lastEventHash =
 * eventHash(last event)`, so it is identical to the old `globalMerkleRoot(state, log)`
 * but needs no O(history) log on the hot path. These two scalars are produced by the
 * SAME `applyTick` that produced the State (single source of truth — see PR-1.2a §2).
 */
function globalMerkleRoot(state: State, eventCount: number, lastEventHash: Uint8Array): string {
  const leaf: StreamLeaf = {
    streamId: "global",
    stateHash: stateRootOf(state),
    lastEventHash: eventCount === 0 ? ZERO32 : lastEventHash,
    lastSeqno: BigInt(eventCount),
  };
  return hex(streamTreeRoot([leaf]));
}

/**
 * The node's maintained live state (PR-1.2a §2). `run()` is the fold of `applyTick` over
 * this accumulator; the OVT daemon carries the same value across ticks so steady-state
 * runtime is O(submissions in the tick), NOT O(history). It carries everything the next
 * tick needs and nothing derivable cheaply from `state`:
 *   - `state`          the evolving reducer State (STATE_ROOT is a pure function of it);
 *   - `currentTick`    the node's authoritative tick (non-decreasing);
 *   - `eventCount`     cumulative event-log length (CE §6.3 `lastSeqno`);
 *   - `lastEventHash`  eventHash of the most recent event (CE §6.3 `lastEventHash`).
 * `eventCount`/`lastEventHash` ride here — not as daemon-side counters — so the global
 * Merkle root can never disagree with the State that produced it.
 */
export interface IncrementalState {
  readonly state: State;
  readonly currentTick: bigint;
  readonly eventCount: number;
  readonly lastEventHash: Uint8Array;
}

/** The fresh accumulator for a genesis state — the start point of the `applyTick` fold. */
export function initIncremental(genesisState?: State): IncrementalState {
  const g = genesisState ?? genesis();
  return { state: g, currentTick: currentTickOf(g), eventCount: 0, lastEventHash: ZERO32 };
}

/** STATE_ROOT (hex) of a live accumulator, without materialising a transcript. */
export function incrementalStateRoot(incr: IncrementalState): string {
  return hex(stateRootOf(incr.state));
}

/** The CE §6.3 global Merkle root (hex) of a live accumulator. */
export function incrementalGlobalRoot(incr: IncrementalState): string {
  return globalMerkleRoot(incr.state, incr.eventCount, incr.lastEventHash);
}

export interface TickStep {
  /** The accumulator AFTER this tick — feed it to the next `applyTick`. */
  readonly next: IncrementalState;
  /** The per-tick result (identical shape to a `Transcript` tick). */
  readonly tickResult: TickResult;
  /** Exactly the events this tick appended to the log, in order (for the derived event log / WAL). */
  readonly events: readonly Event[];
}

/**
 * Apply one tick block to the live accumulator — the single source of fold logic
 * (`run()` is its left fold). Composes the FROZEN validator + reducer and adds no
 * consensus (PR-1.2a discipline). Pure: `(incr, block) -> { next, tickResult, events }`,
 * mutating nothing the caller holds. Throws OrchestratorError on a tick regression or on
 * a validator-emitted event the reducer rejects (an integration defect) — same as before.
 */
export function applyTick(incr: IncrementalState, block: TickBlock): TickStep {
  let state: State = incr.state;
  let currentTick = incr.currentTick;
  let eventCount = incr.eventCount;
  let lastEventHash = incr.lastEventHash;
  const events: Event[] = [];

  const fold = (ev: Event, onErr: (code: string) => void): boolean => {
    const r = apply(state, ev);
    if (!r.ok) {
      onErr(r.code);
      return false;
    }
    state = r.state;
    events.push(ev);
    eventCount += 1;
    lastEventHash = eventHash(ev);
    return true;
  };

  if (block.tick < currentTick) {
    throw new OrchestratorError("TICK_REGRESSION", `block tick ${block.tick} < current ${currentTick}`);
  }
  if (block.tick > currentTick) {
    const adv: Event = { event_type: "tick.advanced", new_tick: block.tick };
    fold(adv, (code) => {
      throw new OrchestratorError("TICK_REJECTED", code);
    });
    currentTick = block.tick;
  }

  const subs: SubmissionResult[] = [];
  for (const sub of block.submissions) {
    const calHashHex = hex(calHash(sub.cal));
    const agentId = strField(sub.cal, "agent_id");
    const subEvents: Event[] = [];
    const stateRoots: string[] = [];
    const record = (ev: Event): void => {
      subEvents.push(ev);
      stateRoots.push(hex(stateRootOf(state)));
    };

    const mode = sub.mode ?? "atomic";

    // resume (Gate #3): the CAL is already in-flight at VALIDATED (left there by an
    // earlier-tick validate-only). No ingress events; drive it to terminal. At a tick
    // past expiration_tick this yields EXPIRED_POST.
    if (mode === "resume") {
      const trace: ExecutionTrace = { ...sub.trace, currentTick };
      const res = resumeFromValidated(sub.cal as VJson, calHashHex, state as unknown as VJson, trace);
      for (const evV of res.events) {
        const ev = evV as unknown as Event;
        fold(ev, (code) => {
          throw new OrchestratorError("APPLY_FAILED", `${res.terminalStage} resume event ${String(ev["event_type"])} rejected: ${code}`);
        });
        record(ev);
      }
      subs.push({ calHash: calHashHex, agentId, terminalStage: res.terminalStage, reasonCode: res.reasonCode, events: subEvents, stateRoots });
      continue;
    }

    // Ingress: cal.created then cal.signed. The reducer enforces §6.1
    // (one in-flight CAL per agent → AGENT_BUSY) and CAL uniqueness here.
    let ingressError: { code: string } | undefined;
    const created: Event = { event_type: "cal.created", cal_hash: calHashHex, agent_id: agentId };
    if (!fold(created, (code) => { ingressError = { code }; })) {
      subs.push({ calHash: calHashHex, agentId, terminalStage: null, reasonCode: null, events: subEvents, stateRoots, ingressError });
      continue;
    }
    record(created);
    const signed: Event = { event_type: "cal.signed", cal_hash: calHashHex };
    if (!fold(signed, (code) => { ingressError = { code }; })) {
      subs.push({ calHash: calHashHex, agentId, terminalStage: null, reasonCode: null, events: subEvents, stateRoots, ingressError });
      continue;
    }
    record(signed);

    // Validate against the live State, then fold the lifecycle events it emits.
    // The node is authoritative on the tick: pin trace.currentTick to its own
    // currentTick so a submission cannot misreport the tick and dodge expiration.
    const trace: ExecutionTrace = { ...sub.trace, currentTick };

    // validate-only (Gate #3): stage 1 — leave the CAL in-flight at VALIDATED (or surface a
    // pre-validation failure as terminal). No execution/finalization this tick.
    if (mode === "validate-only") {
      const s1 = validateToValidated(sub.cal as VJson, calHashHex, state as unknown as VJson, trace);
      const evs = s1.terminal ? s1.terminal.events : s1.events;
      for (const evV of evs) {
        const ev = evV as unknown as Event;
        fold(ev, (code) => {
          throw new OrchestratorError("APPLY_FAILED", `validate-only event ${String(ev["event_type"])} rejected: ${code}`);
        });
        record(ev);
      }
      // terminalStage null = staged-pending (CAL in-flight at VALIDATED, not yet terminal).
      subs.push({ calHash: calHashHex, agentId, terminalStage: s1.terminal ? s1.terminal.terminalStage : null, reasonCode: s1.terminal ? s1.terminal.reasonCode : null, events: subEvents, stateRoots });
      continue;
    }

    const res = validate(sub.cal as VJson, calHashHex, state as unknown as VJson, trace);
    for (const evV of res.events) {
      const ev = evV as unknown as Event;
      fold(ev, (code) => {
        throw new OrchestratorError("APPLY_FAILED", `${res.terminalStage} event ${String(ev["event_type"])} rejected: ${code}`);
      });
      record(ev);
    }
    subs.push({
      calHash: calHashHex,
      agentId,
      terminalStage: res.terminalStage,
      reasonCode: res.reasonCode,
      events: subEvents,
      stateRoots,
    });
  }

  const tickResult: TickResult = {
    tick: currentTick,
    submissions: subs,
    stateRoot: hex(stateRootOf(state)),
    globalMerkleRoot: globalMerkleRoot(state, eventCount, lastEventHash),
  };
  return { next: { state, currentTick, eventCount, lastEventHash }, tickResult, events };
}

/** Run a program to a transcript — the left fold of `applyTick` over the program's ticks
 *  (the single fold logic lives in `applyTick`; this only accumulates). Throws
 *  OrchestratorError on a tick regression or on a validator-emitted event the reducer
 *  rejects (an integration defect). */
export function run(program: Program): Transcript {
  const genesisState: State = program.genesisState ?? genesis();
  let incr = initIncremental(genesisState);
  const ticks: TickResult[] = [];
  const log: Event[] = [];

  for (const block of program.ticks) {
    const step = applyTick(incr, block);
    incr = step.next;
    ticks.push(step.tickResult);
    for (const ev of step.events) log.push(ev);
  }

  return { genesisState, ticks, eventLog: log, finalStateRoot: hex(stateRootOf(incr.state)) };
}

export interface ReplayResult {
  /** STATE_ROOT (hex) after each event. */
  readonly stateRoots: readonly string[];
  readonly finalStateRoot: string;
  readonly error?: { readonly code: string; readonly index: number };
}

/** Re-fold an event log from genesis (the reducer is total & deterministic, §7.2). */
export function replay(eventLog: readonly Event[], genesisState?: State): ReplayResult {
  const start = genesisState ?? genesis();
  const scan = scanStateRoots(eventLog, start);
  const finalStateRoot = scan.roots.length > 0 ? scan.roots[scan.roots.length - 1]! : hex(stateRootOf(start));
  return { stateRoots: scan.roots, finalStateRoot, error: scan.error };
}

/**
 * Replay-determinism check: re-folding a transcript's event log from genesis must
 * reproduce the exact final STATE_ROOT and every per-tick checkpoint root the run
 * recorded. Returns true on a clean match (§7.2 determinism).
 */
export function verifyReplay(t: Transcript): boolean {
  const r = replay(t.eventLog, t.genesisState);
  if (r.error || r.finalStateRoot !== t.finalStateRoot) return false;
  // Each tick's end-of-tick root must appear in the replay's per-event root stream,
  // in tick order (the checkpoints are a subsequence — tick.advanced roots interleave).
  let j = 0;
  for (const tk of t.ticks) {
    while (j < r.stateRoots.length && r.stateRoots[j] !== tk.stateRoot) j++;
    if (j >= r.stateRoots.length) return false;
    j++;
  }
  return true;
}
