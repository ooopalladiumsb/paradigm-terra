// OVT-2 — persistent node: the orchestrator fold as a PROCESS, not a function.
//
// Agent-runtime / operations layer, ABOVE the Freeze Surface — it reuses the proven `run()` fold
// unchanged and only adds durability + recovery around it. The durable write-ahead log (WAL) is the
// ordered submission stream (the inputs); recovery re-folds the WAL from genesis. The event log is
// derived output (reproducible via `replay()`), so the inputs are the source of truth.
//
// Durability model: one NDJSON line per committed tick, fsync'd before the tick is applied
// in-memory (write-ahead). A crash mid-write tears only the trailing line; on restart the loader
// keeps the parseable prefix (the committed ticks) and drops the torn tail — so recovery yields the
// STATE_ROOT as of the last durably-committed tick. OVT-2 hypotheses: H2.1 (process: submit +
// tick advance), H2.2 (persist), H2.3 (replay recovery), H2.4 (crash recovery), H2.5 (deterministic
// re-fold).

import fs from "node:fs";
import path from "node:path";
import { run, type Program, type Submission, type TickResult, type Transcript } from "../index.js";

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

export class OvtNode {
  private constructor(
    private readonly dir: string,
    private readonly genesisState: State,
    private ticks: WalTick[],
    private transcript: Transcript,
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
    const node = new OvtNode(dir, genesisState, [], run({ genesisState, ticks: [] }));
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
    const node = new OvtNode(dir, genesisState, ticks, run({ genesisState, ticks }));
    node.writeHead();
    return node;
  }

  /** Recover a node from disk: re-fold the committed WAL prefix from genesis (the headline path). */
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
    const transcript = run({ genesisState, ticks });
    return new OvtNode(dir, genesisState, ticks, transcript);
  }

  /** Submit a tick's worth of submissions: durably WAL it (write-ahead), then apply (re-fold). */
  submit(submissions: readonly Submission[]): TickResult {
    const tick = BigInt(this.ticks.length);
    const block: WalTick = { tick, submissions };
    appendLineDurable(OvtNode.paths(this.dir).wal, enc(block)); // durable BEFORE applied
    this.ticks.push(block);
    this.transcript = run({ genesisState: this.genesisState, ticks: this.ticks });
    this.writeHead();
    return this.transcript.ticks[this.transcript.ticks.length - 1]!;
  }

  stateRoot(): string {
    return this.transcript.finalStateRoot;
  }
  /** Cumulative event-log Merkle root (CE §6.3) as of the latest tick. */
  eventLogRoot(): string {
    return this.ticks.length === 0 ? "" : this.transcript.ticks[this.transcript.ticks.length - 1]!.globalMerkleRoot;
  }
  eventLog(): Transcript["eventLog"] {
    return this.transcript.eventLog;
  }
  getTranscript(): Transcript {
    return this.transcript;
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
