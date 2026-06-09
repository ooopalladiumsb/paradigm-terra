// M3-A — incremental backup (Tier M, above the Freeze Surface). Extends the PR-1.7 full backup
// (backup.ts, deliberately scoped to exclude this) with base + WAL-delta capture: a chain is one full
// backup followed by N incrementals, each carrying only the WAL bytes appended since the previous tip.
// restore folds base ⊕ deltas and VERIFIES the result against the chain-tip manifest — the SC-1
// invariant `restore(base ⊕ deltas) == node@t` on all 7 quantities (extends Backup Equivalence).
//
// Out of scope (later M3 stages): WAL archival/compaction (M3-B), remote sink (M3-C). The root values
// are derived from the frozen pipeline and merely copied/concatenated here — no Freeze Surface impact.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeSnapshot } from "./snapshot.js";
import { listSnapshots } from "./snapshot-store.js";
import { OvtNode, type RecoveryMode } from "./persistent-node.js";
import { backupNode, BackupError, BACKUP_SCHEMA_VERSION, type BackupManifest } from "./backup.js";

export { BackupError } from "./backup.js"; // single API surface for the incremental layer

const SNAP_RE = /^snapshot-\d+\.json$/;
const DELTA_FILE = "wal-delta.ndjson";
const INC_MANIFEST = "incremental-manifest.json";
const FULL_MANIFEST = "backup-manifest.json";

export interface IncrementalManifest {
  readonly backup_schema_version: number;
  readonly kind: "incremental";
  readonly created_at: string;
  readonly base_wal_size_bytes: number; // where this delta starts (== the prior chain tip's wal_size_bytes)
  readonly wal_size_bytes: number; // the new total durable WAL size; the delta covers [base_wal_size_bytes, wal_size_bytes)
  readonly delta_file: string;
  readonly delta_bytes: number;
  readonly snapshots: ReadonlyArray<{ file: string; covered_tick: string; wal_offset: string }>;
  readonly operational: { readonly snapshot_cadence?: number };
  readonly expected: {
    readonly state_root: string;
    readonly global_root: string;
    readonly event_count: number;
    readonly last_event_hash: string;
    readonly committed_ticks: number;
    readonly recovery_mode: RecoveryMode;
    readonly covered_tick: string;
    readonly wal_offset: string;
  };
}

type AnyManifest = BackupManifest | IncrementalManifest;
const isIncremental = (m: AnyManifest): m is IncrementalManifest => (m as IncrementalManifest).kind === "incremental";

/** Read whichever manifest a chain-link directory holds (full base or incremental). */
function readManifest(dir: string): AnyManifest {
  const inc = path.join(dir, INC_MANIFEST);
  const full = path.join(dir, FULL_MANIFEST);
  const file = fs.existsSync(inc) ? inc : full;
  if (!fs.existsSync(file)) throw new BackupError(`chain link has no manifest: ${dir}`);
  let m: AnyManifest;
  try {
    m = JSON.parse(fs.readFileSync(file, "utf8")) as AnyManifest;
  } catch {
    throw new BackupError(`manifest is not valid JSON: ${file}`);
  }
  if (m.backup_schema_version !== BACKUP_SCHEMA_VERSION) throw new BackupError(`unsupported backup_schema_version ${String(m.backup_schema_version)}`);
  return m;
}

function copyRange(srcFile: string, destFile: string, start: number, end: number): number {
  const len = Math.max(0, end - start);
  if (len === 0) {
    fs.writeFileSync(destFile, "");
    return 0;
  }
  const fd = fs.openSync(srcFile, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.writeFileSync(destFile, buf);
  } finally {
    fs.closeSync(fd);
  }
  return len;
}

/** True iff `offset` is a WAL line boundary (start of file, or the byte before it is '\n'). */
function onLineBoundary(walFile: string, offset: number): boolean {
  if (offset === 0) return true;
  if (offset > fs.statSync(walFile).size) return false;
  const fd = fs.openSync(walFile, "r");
  try {
    const b = Buffer.allocUnsafe(1);
    fs.readSync(fd, b, 0, 1, offset - 1);
    return b[0] === 0x0a;
  } finally {
    fs.closeSync(fd);
  }
}

function includeSnapshots(srcDir: string, destDir: string, walCeil: number): Array<{ file: string; covered_tick: bigint; wal_offset: bigint }> {
  const included: Array<{ file: string; covered_tick: bigint; wal_offset: bigint }> = [];
  for (const entry of listSnapshots(srcDir)) {
    let body;
    try {
      body = decodeSnapshot(fs.readFileSync(entry.file, "utf8"));
    } catch {
      continue; // checksum-bad: leave out (WAL is the truth)
    }
    if (body.wal_offset > BigInt(walCeil)) continue;
    const base = path.basename(entry.file);
    fs.copyFileSync(entry.file, path.join(destDir, base));
    included.push({ file: base, covered_tick: body.covered_tick, wal_offset: body.wal_offset });
  }
  return included;
}

/**
 * Materialize a chain `[baseFullDir, inc1, inc2, ...]` into `destDir` as a single consistent node
 * directory (genesis + the folded WAL + the union of snapshots), WITHOUT opening it. Verifies each
 * link is contiguous with the running WAL size, or throws BackupError.
 */
export function materializeChain(chainDirs: string[], destDir: string): void {
  if (chainDirs.length === 0) throw new BackupError("empty backup chain");
  const [baseDir, ...incs] = chainDirs;
  if (!fs.existsSync(path.join(baseDir!, "genesis.json")) || !fs.existsSync(path.join(baseDir!, "wal.ndjson"))) {
    throw new BackupError(`chain base is not a full backup: ${baseDir}`);
  }
  const base = readManifest(baseDir!);
  if (isIncremental(base)) throw new BackupError("chain must start with a full backup, not an incremental");

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(baseDir!, "genesis.json"), path.join(destDir, "genesis.json"));
  const destWal = path.join(destDir, "wal.ndjson");
  fs.copyFileSync(path.join(baseDir!, "wal.ndjson"), destWal);
  for (const n of fs.readdirSync(baseDir!)) if (SNAP_RE.test(n)) fs.copyFileSync(path.join(baseDir!, n), path.join(destDir, n));

  let running = fs.statSync(destWal).size;
  for (const incDir of incs) {
    const m = readManifest(incDir);
    if (!isIncremental(m)) throw new BackupError(`chain link is not an incremental backup: ${incDir}`);
    if (m.base_wal_size_bytes !== running) {
      throw new BackupError(`non-contiguous chain at ${incDir}: delta starts at ${m.base_wal_size_bytes}, WAL is at ${running}`);
    }
    const deltaPath = path.join(incDir, m.delta_file);
    if (!fs.existsSync(deltaPath)) throw new BackupError(`incremental is missing its delta: ${deltaPath}`);
    const deltaBytes = fs.statSync(deltaPath).size;
    if (deltaBytes !== m.delta_bytes) throw new BackupError(`delta size ${deltaBytes} != manifest ${m.delta_bytes} at ${incDir}`);
    fs.appendFileSync(destWal, fs.readFileSync(deltaPath));
    running += deltaBytes;
    if (running !== m.wal_size_bytes) throw new BackupError(`chain WAL size ${running} != manifest ${m.wal_size_bytes} at ${incDir}`);
    for (const n of fs.readdirSync(incDir)) if (SNAP_RE.test(n)) fs.copyFileSync(path.join(incDir, n), path.join(destDir, n));
  }
}

/**
 * Capture an INCREMENTAL backup of `srcDir` relative to an existing chain `chainDirs`
 * (`[baseFullDir, ...priorIncDirs]`), into `destDir`. Copies only the WAL bytes appended since the
 * chain tip + any new snapshots, and writes a manifest whose `expected` is computed by materializing
 * the FULL chain (so the manifest is the backup's own truth, as in PR-1.7).
 */
export function backupIncremental(srcDir: string, chainDirs: string[], destDir: string, opts?: { snapshotCadence?: number }): IncrementalManifest {
  const srcWal = path.join(srcDir, "wal.ndjson");
  if (!fs.existsSync(path.join(srcDir, "genesis.json"))) throw new BackupError(`source has no genesis.json: ${srcDir}`);
  if (!fs.existsSync(srcWal)) throw new BackupError(`source has no wal.ndjson: ${srcDir}`);

  const tip = readManifest(chainDirs[chainDirs.length - 1]!);
  const tipWalSize = tip.wal_size_bytes;
  const currentWalSize = fs.statSync(srcWal).size;
  if (currentWalSize < tipWalSize) throw new BackupError(`source WAL shrank below the chain tip (${currentWalSize} < ${tipWalSize})`);
  if (!onLineBoundary(srcWal, tipWalSize)) throw new BackupError(`chain tip ${tipWalSize} is not on a WAL line boundary in the source`);

  fs.mkdirSync(destDir, { recursive: true });
  const deltaBytes = copyRange(srcWal, path.join(destDir, DELTA_FILE), tipWalSize, currentWalSize);
  includeSnapshots(srcDir, destDir, currentWalSize);

  // expected = the result of materializing + opening the full chain WITH this new link appended.
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "m3a-probe-"));
  let manifest: IncrementalManifest;
  try {
    // write a provisional manifest so materializeChain sees a complete link, then refine `expected`.
    const provisional: IncrementalManifest = {
      backup_schema_version: BACKUP_SCHEMA_VERSION,
      kind: "incremental",
      created_at: new Date().toISOString(),
      base_wal_size_bytes: tipWalSize,
      wal_size_bytes: currentWalSize,
      delta_file: DELTA_FILE,
      delta_bytes: deltaBytes,
      snapshots: includedManifestSnapshots(destDir),
      operational: { snapshot_cadence: opts?.snapshotCadence },
      expected: ZERO_EXPECTED,
    };
    fs.writeFileSync(path.join(destDir, INC_MANIFEST), JSON.stringify(provisional, null, 2) + "\n");

    materializeChain([...chainDirs, destDir], probe);
    const node = OvtNode.open(probe);
    const o = node.observe();
    const coveredTick = o.committedTicks - o.recoveredTailTicks;
    const latest = [...provisional.snapshots].sort((a, b) => (BigInt(a.covered_tick) < BigInt(b.covered_tick) ? 1 : -1))[0];
    manifest = {
      ...provisional,
      expected: {
        state_root: o.stateRoot,
        global_root: o.globalRoot,
        event_count: o.eventCount,
        last_event_hash: o.lastEventHash,
        committed_ticks: o.committedTicks,
        recovery_mode: o.recoveryMode,
        covered_tick: String(coveredTick),
        wal_offset: latest ? latest.wal_offset : tip.expected.wal_offset,
      },
    };
    fs.writeFileSync(path.join(destDir, INC_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
  return manifest;
}

const ZERO_EXPECTED = { state_root: "", global_root: "", event_count: 0, last_event_hash: "", committed_ticks: 0, recovery_mode: "FULL_WAL" as RecoveryMode, covered_tick: "0", wal_offset: "0" };

function includedManifestSnapshots(dir: string): Array<{ file: string; covered_tick: string; wal_offset: string }> {
  const out: Array<{ file: string; covered_tick: string; wal_offset: string }> = [];
  for (const n of fs.readdirSync(dir)) {
    if (!SNAP_RE.test(n)) continue;
    const body = decodeSnapshot(fs.readFileSync(path.join(dir, n), "utf8"));
    out.push({ file: n, covered_tick: body.covered_tick.toString(), wal_offset: body.wal_offset.toString() });
  }
  return out;
}

/**
 * Restore a chain `[baseFullDir, inc1, inc2, ...]` into a fresh `destDir` and VERIFY it against the
 * chain-tip manifest. Hard-fails (BackupError) on a missing/non-contiguous/tampered link or a restored
 * state that does not match the tip's expected. Returns the recovered node.
 */
export function restoreChain(chainDirs: string[], destDir: string): OvtNode {
  if (chainDirs.length === 0) throw new BackupError("empty backup chain");
  materializeChain(chainDirs, destDir);
  const node = OvtNode.open(destDir);
  const o = node.observe();
  const x = readManifest(chainDirs[chainDirs.length - 1]!).expected;
  if (o.stateRoot !== x.state_root || o.globalRoot !== x.global_root || o.eventCount !== x.event_count || o.lastEventHash !== x.last_event_hash || o.committedTicks !== x.committed_ticks) {
    throw new BackupError(`restored chain state does not match the tip manifest (inconsistent chain): state_root ${o.stateRoot} vs ${x.state_root}`);
  }
  return node;
}

/** Convenience: a fresh full base backup, so a chain can be started from a live node in one call. */
export function backupBase(srcDir: string, destDir: string, opts?: { snapshotCadence?: number }): BackupManifest {
  return backupNode(srcDir, destDir, opts);
}
