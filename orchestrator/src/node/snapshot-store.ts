// PR-1.2c-B — snapshot store: the filesystem side of snapshots (atomic write, validated load,
// retention). Operations layer, above the Freeze Surface. Builds on the proven codec (snapshot.ts).
//
// Atomicity (Rule 3): write to a TMP file, fsync it, then atomic rename → publish. A crash before the
// rename leaves only an ignorable TMP; a published snapshot is therefore always complete. The WAL stays
// the only commit authority (Rule 1): a snapshot is a discardable accelerator, never a source of truth.
//
// Load discipline:
//   - checksum FAILURE  → discardable (Rule 1): skip this file, fall back to an older snapshot or to
//     the full WAL re-fold (which always works).
//   - checksum VALID but covered_tick > committed WAL ticks → HARD ABORT (SnapshotCorruptionError): a
//     snapshot newer than the durable WAL means the write model itself was violated; do not self-heal.

import fs from "node:fs";
import path from "node:path";
import { decodeSnapshot, encodeSnapshot, SnapshotCorruptionError, type SnapshotBody } from "./snapshot.js";

const SNAP_RE = /^snapshot-(\d+)\.json$/;
const fileFor = (dir: string, coveredTick: bigint): string => path.join(dir, `snapshot-${coveredTick}.json`);

/** Atomically publish a snapshot: TMP → fsync → rename. Returns the published file path. */
export function writeSnapshotFile(dir: string, body: SnapshotBody): string {
  const file = fileFor(dir, body.covered_tick);
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, encodeSnapshot(body));
    fs.fsyncSync(fd); // durable before publish
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file); // atomic publish (a crash before this leaves only the ignorable .tmp)
  return file;
}

interface SnapEntry {
  readonly coveredTick: bigint;
  readonly file: string;
}

/** Published snapshot files (TMPs ignored), newest covered_tick first. */
export function listSnapshots(dir: string): SnapEntry[] {
  if (!fs.existsSync(dir)) return [];
  const out: SnapEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = SNAP_RE.exec(name);
    if (m) out.push({ coveredTick: BigInt(m[1]!), file: path.join(dir, name) });
  }
  return out.sort((a, b) => (a.coveredTick < b.coveredTick ? 1 : a.coveredTick > b.coveredTick ? -1 : 0));
}

/**
 * The newest VALID snapshot at or below the committed WAL, or null if none is usable.
 * `walSize` = current WAL size in bytes. Throws SnapshotCorruptionError (hard abort) on a checksum-valid
 * snapshot whose `wal_offset` exceeds the WAL size — a snapshot newer than the WAL is a write-model
 * violation, not a recoverable case (the byte-level analogue of covered_tick > committed; O(1) via stat,
 * no need to count ticks). Checksum-invalid snapshots are silently skipped (Rule 1 fallback).
 */
export function loadLatestValidSnapshot(dir: string, walSize: number): SnapshotBody | null {
  for (const entry of listSnapshots(dir)) {
    let body: SnapshotBody;
    try {
      body = decodeSnapshot(fs.readFileSync(entry.file, "utf8"));
    } catch (e) {
      if (e instanceof SnapshotCorruptionError) continue; // discardable: try the next-oldest
      throw e;
    }
    if (body.wal_offset > BigInt(walSize)) {
      throw new SnapshotCorruptionError(
        `snapshot ${entry.file} wal_offset ${body.wal_offset} > WAL size ${walSize} bytes — snapshot newer than WAL (write-model violation)`,
      );
    }
    return body; // newest valid
  }
  return null;
}

/** Retain the newest `keep` snapshots; delete older published files (and any stale TMPs). */
export function pruneSnapshots(dir: string, keep = 2): void {
  const snaps = listSnapshots(dir);
  for (let i = keep; i < snaps.length; i++) fs.rmSync(snaps[i]!.file, { force: true });
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (name.endsWith(".json.tmp")) fs.rmSync(path.join(dir, name), { force: true });
}
