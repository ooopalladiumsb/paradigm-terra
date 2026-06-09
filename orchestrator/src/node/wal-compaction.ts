// M3-B — WAL archival / compaction (Tier M, above the Freeze Surface). Bounds on-disk LIVE WAL growth
// by archiving the event-log prefix that a snapshot already covers: the live `wal.ndjson` keeps only the
// tail `[wal_offset, end)`, the covered prefix `[0, wal_offset)` moves to an archive, and the retained
// snapshot is REBASED to `wal_offset = 0` (same state/covered_tick) so the proven snapshot+tail recovery
// reproduces the identical roots. SC-2: replay-from-compacted == replay-from-full (archive ⊕ tail).
//
// Safety: after a cut the archived prefix is no longer in the live WAL, so the rebased snapshot is
// load-bearing. `restoreCompacted` therefore falls back to a full replay over `archive ⊕ tail` (NOT
// tail-only) if the snapshot is corrupt — the archive is the WAL-of-record, the snapshot an accelerator.
//
// Uses persistent-node / snapshot APIs only; the proven kernel is untouched. No Freeze Surface impact.

import fs from "node:fs";
import path from "node:path";
import { decodeSnapshot, encodeSnapshot, makeSnapshotBody, SnapshotCorruptionError } from "./snapshot.js";
import { listSnapshots } from "./snapshot-store.js";
import { OvtNode, type RecoveryMode } from "./persistent-node.js";
import { BackupError } from "./backup.js";

export { BackupError } from "./backup.js";

const SNAP_RE = /^snapshot-\d+\.json$/;
const ARCHIVE_FILE = "wal-archive.ndjson";
const MANIFEST = "compaction-manifest.json";
export const COMPACTION_SCHEMA_VERSION = 1;

export interface CompactionManifest {
  readonly compaction_schema_version: number;
  readonly created_at: string;
  readonly cut_offset: number; // bytes [0, cut_offset) archived; live WAL = [cut_offset, original_end)
  readonly covered_tick: string; // the rebased snapshot's covered tick
  readonly archive_file: string;
  readonly archive_bytes: number;
  readonly live_wal_bytes: number;
  readonly original_wal_bytes: number; // archive_bytes + live_wal_bytes (byte-exact split)
  readonly expected: {
    readonly state_root: string;
    readonly global_root: string;
    readonly event_count: number;
    readonly last_event_hash: string;
    readonly committed_ticks: number;
    readonly recovery_mode: RecoveryMode;
  };
}

const onBoundary = (walFile: string, offset: number): boolean => {
  if (offset === 0) return true;
  const size = fs.statSync(walFile).size;
  if (offset > size) return false;
  const fd = fs.openSync(walFile, "r");
  try {
    const b = Buffer.allocUnsafe(1);
    fs.readSync(fd, b, 0, 1, offset - 1);
    return b[0] === 0x0a;
  } finally {
    fs.closeSync(fd);
  }
};

function readRange(file: string, start: number, end: number): Buffer {
  const len = Math.max(0, end - start);
  if (len === 0) return Buffer.alloc(0);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** The latest valid snapshot at-or-below the WAL size (the cut point), or null. */
function latestValidSnapshot(srcDir: string, walSize: number): { file: string; coveredTick: bigint; walOffset: bigint; text: string } | null {
  let best: { file: string; coveredTick: bigint; walOffset: bigint; text: string } | null = null;
  for (const entry of listSnapshots(srcDir)) {
    const text = fs.readFileSync(entry.file, "utf8");
    let body;
    try {
      body = decodeSnapshot(text);
    } catch {
      continue; // checksum-bad: skip (Rule 1)
    }
    if (body.wal_offset > BigInt(walSize)) continue;
    if (!best || body.covered_tick > best.coveredTick) best = { file: path.basename(entry.file), coveredTick: body.covered_tick, walOffset: body.wal_offset, text };
  }
  return best;
}

/**
 * Compact `srcDir` into a fresh `destDir`: archive the prefix the latest snapshot covers, keep only the
 * live tail, rebase that snapshot to offset 0, and write a manifest of the expected state. Returns it.
 * Throws BackupError if there is no usable snapshot to cut at (nothing safe to archive).
 */
export function compactNode(srcDir: string, destDir: string): CompactionManifest {
  const srcGenesis = path.join(srcDir, "genesis.json");
  const srcWal = path.join(srcDir, "wal.ndjson");
  if (!fs.existsSync(srcGenesis)) throw new BackupError(`source has no genesis.json: ${srcDir}`);
  if (!fs.existsSync(srcWal)) throw new BackupError(`source has no wal.ndjson: ${srcDir}`);
  const walSize = fs.statSync(srcWal).size;

  const snap = latestValidSnapshot(srcDir, walSize);
  if (!snap) throw new BackupError("no valid snapshot to compact behind (nothing safe to archive)");
  const cut = Number(snap.walOffset);
  if (!onBoundary(srcWal, cut)) throw new BackupError(`snapshot wal_offset ${cut} is not on a WAL line boundary`);

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcGenesis, path.join(destDir, "genesis.json"));

  // archive the covered prefix; live WAL = the tail.
  const archive = readRange(srcWal, 0, cut);
  fs.writeFileSync(path.join(destDir, ARCHIVE_FILE), archive);
  const tail = readRange(srcWal, cut, walSize);
  fs.writeFileSync(path.join(destDir, "wal.ndjson"), tail);

  // rebase the retained snapshot to wal_offset 0 (same state + covered_tick), drop the rest.
  const body = decodeSnapshot(snap.text);
  const rebased = makeSnapshotBody(body.incr, body.covered_tick, 0n);
  fs.writeFileSync(path.join(destDir, snap.file), encodeSnapshot(rebased));

  // expected = opening the compacted dir (snapshot + tail).
  const node = OvtNode.open(destDir);
  const o = node.observe();
  const manifest: CompactionManifest = {
    compaction_schema_version: COMPACTION_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    cut_offset: cut,
    covered_tick: body.covered_tick.toString(),
    archive_file: ARCHIVE_FILE,
    archive_bytes: archive.length,
    live_wal_bytes: tail.length,
    original_wal_bytes: walSize,
    expected: {
      state_root: o.stateRoot,
      global_root: o.globalRoot,
      event_count: o.eventCount,
      last_event_hash: o.lastEventHash,
      committed_ticks: o.committedTicks,
      recovery_mode: o.recoveryMode,
    },
  };
  fs.writeFileSync(path.join(destDir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function readManifest(compactedDir: string): CompactionManifest {
  const f = path.join(compactedDir, MANIFEST);
  if (!fs.existsSync(f)) throw new BackupError(`compacted dir has no manifest: ${compactedDir}`);
  let m: CompactionManifest;
  try {
    m = JSON.parse(fs.readFileSync(f, "utf8")) as CompactionManifest;
  } catch {
    throw new BackupError("compaction manifest is not valid JSON");
  }
  if (m.compaction_schema_version !== COMPACTION_SCHEMA_VERSION) throw new BackupError(`unsupported compaction_schema_version ${String(m.compaction_schema_version)}`);
  return m;
}

/** Reconstruct the original full WAL (archive ⊕ live tail) and full-replay it from genesis (no snapshot)
 *  into `destDir`. This is the SC-2 "replay-from-full" path AND the safe fallback when the snapshot is bad. */
export function replayFromFull(compactedDir: string, destDir: string): OvtNode {
  const m = readManifest(compactedDir);
  const archive = path.join(compactedDir, m.archive_file);
  if (!fs.existsSync(archive)) throw new BackupError(`compacted dir is missing its archive: ${archive}`);
  const archiveBytes = fs.readFileSync(archive);
  const liveBytes = fs.readFileSync(path.join(compactedDir, "wal.ndjson"));
  if (archiveBytes.length !== m.archive_bytes || liveBytes.length !== m.live_wal_bytes) {
    throw new BackupError(`archive/live size != manifest (${archiveBytes.length}/${liveBytes.length} vs ${m.archive_bytes}/${m.live_wal_bytes})`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(compactedDir, "genesis.json"), path.join(destDir, "genesis.json"));
  fs.writeFileSync(path.join(destDir, "wal.ndjson"), Buffer.concat([archiveBytes, liveBytes])); // full WAL, no snapshot ⇒ FULL_REPLAY
  return OvtNode.open(destDir);
}

/**
 * Restore a compacted node into a fresh `destDir` and VERIFY against the manifest. Fast path: snapshot +
 * live tail (copies the compacted dir, opens). If the snapshot is corrupt (SnapshotCorruptionError) it
 * falls back to a full replay over `archive ⊕ tail` (the archive is the WAL-of-record). Either way the
 * recovered roots must equal the manifest, or BackupError.
 */
export function restoreCompacted(compactedDir: string, destDir: string): OvtNode {
  const m = readManifest(compactedDir);
  const matches = (o: ReturnType<OvtNode["observe"]>): boolean =>
    o.stateRoot === m.expected.state_root &&
    o.globalRoot === m.expected.global_root &&
    o.eventCount === m.expected.event_count &&
    o.lastEventHash === m.expected.last_event_hash &&
    o.committedTicks === m.expected.committed_ticks;

  // Fast path: snapshot + live tail. A corrupt snapshot either throws (ahead-of-WAL) OR is silently
  // skipped (checksum-bad, Rule 1) — and after compaction a skip leaves only the tail, i.e. the WRONG
  // state. So we accept the fast path ONLY if it reproduces the manifest; otherwise fall back.
  fs.mkdirSync(destDir, { recursive: true });
  let fast: OvtNode | null = null;
  try {
    fs.copyFileSync(path.join(compactedDir, "genesis.json"), path.join(destDir, "genesis.json"));
    fs.copyFileSync(path.join(compactedDir, "wal.ndjson"), path.join(destDir, "wal.ndjson"));
    for (const n of fs.readdirSync(compactedDir)) if (SNAP_RE.test(n)) fs.copyFileSync(path.join(compactedDir, n), path.join(destDir, n));
    const node = OvtNode.open(destDir);
    if (matches(node.observe())) fast = node;
  } catch (e) {
    if (!(e instanceof SnapshotCorruptionError)) throw e;
  }
  if (fast) return fast;

  // Safe fallback: the archive is the WAL-of-record ⇒ full replay over archive ⊕ tail.
  fs.rmSync(destDir, { recursive: true, force: true });
  const node = replayFromFull(compactedDir, destDir);
  if (!matches(node.observe())) {
    throw new BackupError(`restored compacted state does not match the manifest: state_root ${node.observe().stateRoot} vs ${m.expected.state_root}`);
  }
  return node;
}
