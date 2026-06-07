// OVT-2 — persistent node: the orchestrator fold as a PROCESS, not a function.
//
// Agent-runtime / operations layer, ABOVE the Freeze Surface — it composes the proven `applyTick`
// fold unchanged and only adds durability + recovery around it. The durable write-ahead log (WAL) is
// the ordered submission stream (the inputs); recovery re-folds the WAL from genesis. The event log is
// derived output, so the inputs are the source of truth.
//
// PR-1.2b: the node now MAINTAINS live state. `submit()` advances a carried `IncrementalState` by one
// tick via `applyTick` (work = O(submissions in the tick)), instead of re-folding the whole WAL from
// genesis every tick (the old O(n)/tick wall the PR-1.1a profile measured). Full re-folds survive only
// where they belong: `open()` (cold recovery — one O(history) fold at boot, until PR-1.2c snapshots
// shorten it) and `bulkCreate()` (one-shot batch build). The carried (eventCount, lastEventHash) ride
// inside IncrementalState — the same source of truth as STATE_ROOT — so no daemon-side counter can drift.
//
// Durability model: one NDJSON line per committed tick, fsync'd before the tick is applied in-memory
// (write-ahead). A crash mid-write tears only the trailing line; on restart the loader keeps the
// parseable prefix (the committed ticks) and drops the torn tail — so recovery yields the STATE_ROOT
// as of the last durably-committed tick. OVT-2 hypotheses: H2.1 (process: submit + tick advance),
// H2.2 (persist), H2.3 (replay recovery), H2.4 (crash recovery), H2.5 (deterministic re-fold).

import fs from "node:fs";
import path from "node:path";
import {
  applyTick,
  incrementalGlobalRoot,
  incrementalStateRoot,
  initIncremental,
  type Event,
  type IncrementalState,
  type Program,
  type Submission,
  type TickBlock,
  type TickResult,
  type Transcript,
} from "../index.js";
import { makeSnapshotBody } from "./snapshot.js";
import { loadLatestValidSnapshot, pruneSnapshots, writeSnapshotFile } from "./snapshot-store.js";

type State = NonNullable<Program["genesisState"]>;

// --- bigint-tagged JSON codec (CALs carry bigint nonce/expiration/const; state carries balances) ---
const BTAG = "$bigint";
const enc = (obj: unknown): string => JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? { [BTAG]: v.toString() } : v));
const dec = (text: string): unknown =>
  JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && typeof (v as Record<string, unknown>)[BTAG] === "string" && Object.keys(v).length === 1
      ? BigInt((v as Record<string, string>)[BTAG] as string)
      : v,
  );

interface WalTick {
  readonly tick: bigint;
  readonly submissions: readonly Submission[];
}

function appendLineDurable(file: string, line: string): void {
  const fd = fs.openSync(file, "a");
  try {
    fs.writeSync(fd, line + "\n");
    fs.fsyncSync(fd); // write-ahead: the tick is durable before it is applied
  } finally {
    fs.closeSync(fd);
  }
}

/** Fold a list of tick blocks onto a starting live state via the proven `applyTick` (single fold
 *  logic). Used by the O(history) full re-fold (start = genesis) AND by snapshot recovery (start =
 *  the snapshot's IncrementalState, blocks = the WAL tail). The returned tickResults / eventLog cover
 *  only the folded `blocks` — on the snapshot path that is the tail, by design (the historical log is
 *  not rematerialised; the authoritative roots live in `incr`). */
function foldBlocks(startIncr: IncrementalState, blocks: readonly WalTick[]): {
  incr: IncrementalState;
  tickResults: TickResult[];
  eventLog: Event[];
} {
  let incr = startIncr;
  const tickResults: TickResult[] = [];
  const eventLog: Event[] = [];
  for (const b of blocks) {
    const step = applyTick(incr, b as TickBlock);
    incr = step.next;
    tickResults.push(step.tickResult);
    for (const e of step.events) eventLog.push(e);
  }
  return { incr, tickResults, eventLog };
}

const foldFromGenesis = (genesisState: State, blocks: readonly WalTick[]) => foldBlocks(initIncremental(genesisState), blocks);

export class OvtNode {
  private constructor(
    private readonly dir: string,
    private readonly genesisState: State,
    private ticks: WalTick[],
    // PR-1.2b maintained live state (carried across ticks — never re-derived on the hot path):
    private liveIncr: IncrementalState,
    private tickResults: TickResult[],
    private eventLogArr: Event[],
  ) {}

  private static paths(dir: string) {
    return { genesis: path.join(dir, "genesis.json"), wal: path.join(dir, "wal.ndjson"), head: path.join(dir, "head.json") };
  }

  /** Initialize an empty node at `dir`, persisting the genesis state. */
  static create(dir: string, genesisState: State): OvtNode {
    fs.mkdirSync(dir, { recursive: true });
    const p = OvtNode.paths(dir);
    fs.writeFileSync(p.genesis, enc(genesisState));
    fs.writeFileSync(p.wal, "");
    const { incr, tickResults, eventLog } = foldFromGenesis(genesisState, []);
    const node = new OvtNode(dir, genesisState, [], incr, tickResults, eventLog);
    node.writeHead();
    return node;
  }

  /** Persist many ticks at once (one WAL write, one fold) — for OVT-SG state-growth measurement,
   * where building via N separate `submit()` calls would be an O(n²) harness artifact. */
  static bulkCreate(dir: string, genesisState: State, tickBlocks: readonly WalTick[]): OvtNode {
    fs.mkdirSync(dir, { recursive: true });
    const p = OvtNode.paths(dir);
    fs.writeFileSync(p.genesis, enc(genesisState));
    fs.writeFileSync(p.wal, tickBlocks.map((b) => enc(b)).join("\n") + (tickBlocks.length ? "\n" : ""));
    const ticks = tickBlocks.slice();
    const { incr, tickResults, eventLog } = foldFromGenesis(genesisState, ticks);
    const node = new OvtNode(dir, genesisState, ticks, incr, tickResults, eventLog);
    node.writeHead();
    return node;
  }

  /** Recover a node from disk. Cold-recovery path: if a valid snapshot exists, restore from it and
   *  replay only the WAL tail (PR-1.2c-B); otherwise re-fold the whole committed WAL from genesis
   *  (the O(history) baseline, always correct). Either way `liveIncr` is authoritative — the snapshot
   *  is a discardable accelerator (Rule 1). Throws SnapshotCorruptionError on an ahead-of-WAL snapshot
   *  (a write-model violation — hard abort, never self-heal). */
  static open(dir: string): OvtNode {
    const p = OvtNode.paths(dir);
    const genesisState = dec(fs.readFileSync(p.genesis, "utf8")) as State;
    const raw = fs.existsSync(p.wal) ? fs.readFileSync(p.wal, "utf8") : "";
    const ticks: WalTick[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let blk: WalTick;
      try {
        blk = dec(t) as WalTick;
      } catch {
        break; // torn/partial trailing line = a crash mid-write; keep the committed prefix only
      }
      ticks.push(blk);
    }

    // snapshot path: restore(snapshot) + replay_tail(WAL after covered_tick). loadLatestValidSnapshot
    // skips checksum-bad snapshots (Rule 1) and hard-aborts on an ahead-of-WAL one (Rule 3).
    const snap = loadLatestValidSnapshot(dir, ticks.length);
    const start = snap ? snap.incr : initIncremental(genesisState);
    const tail = snap ? ticks.slice(Number(snap.covered_tick)) : ticks;
    const { incr, tickResults, eventLog } = foldBlocks(start, tail);
    return new OvtNode(dir, genesisState, ticks, incr, tickResults, eventLog);
  }

  /** Submit a tick's worth of submissions: durably WAL it (write-ahead), then apply it INCREMENTALLY
   *  to the carried live state. Work is O(submissions in this tick) — NOT O(history): no re-fold. */
  submit(submissions: readonly Submission[]): TickResult {
    const tick = BigInt(this.ticks.length);
    const block: WalTick = { tick, submissions };
    appendLineDurable(OvtNode.paths(this.dir).wal, enc(block)); // durable BEFORE applied
    this.ticks.push(block);
    const step = applyTick(this.liveIncr, block as TickBlock); // O(tick), composes the frozen validator+reducer
    this.liveIncr = step.next;
    this.tickResults.push(step.tickResult);
    for (const e of step.events) this.eventLogArr.push(e);
    this.writeHead();
    return step.tickResult;
  }

  /** Persist the current live state as a snapshot (atomic publish; retain ≥`keep`). `covered_tick` =
   *  the count of committed WAL ticks folded in (tail replay on the next open starts at this index).
   *  Off the commit path: the WAL is already durable, so this only accelerates a future recovery and
   *  can never lose data (Rule 1). Returns the published snapshot file path. */
  snapshot(keep = 2): string {
    const file = writeSnapshotFile(this.dir, makeSnapshotBody(this.liveIncr, BigInt(this.ticks.length)));
    pruneSnapshots(this.dir, keep);
    return file;
  }

  stateRoot(): string {
    return incrementalStateRoot(this.liveIncr);
  }
  /** Cumulative event-log Merkle root (CE §6.3) as of the latest tick — derived from the carried live
   *  state (single source of truth), so it is correct after a snapshot recovery whose in-memory tail is
   *  empty. "" only when no events have ever been committed (eventCount 0). */
  eventLogRoot(): string {
    return this.liveIncr.eventCount === 0 ? "" : incrementalGlobalRoot(this.liveIncr);
  }
  eventLog(): Transcript["eventLog"] {
    return this.eventLogArr;
  }
  getTranscript(): Transcript {
    return {
      genesisState: this.genesisState,
      ticks: this.tickResults,
      eventLog: this.eventLogArr,
      finalStateRoot: incrementalStateRoot(this.liveIncr),
    };
  }
  tickCount(): number {
    return this.ticks.length;
  }

  private writeHead(): void {
    fs.writeFileSync(
      OvtNode.paths(this.dir).head,
      JSON.stringify({ tickCount: this.ticks.length, finalStateRoot: this.stateRoot(), eventLogRoot: this.eventLogRoot() }, null, 2),
    );
  }
}
