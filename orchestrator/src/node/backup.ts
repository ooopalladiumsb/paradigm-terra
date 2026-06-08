// PR-1.7 — backup / restore. A backup is a CONSISTENT capture of a node's operational truth (genesis +
// the durable WAL prefix + the snapshot store + operational metadata + a manifest of the expected
// state), and restore reproduces that state in a fresh directory and VERIFIES it. The manifest is what
// makes a backup "a consistent state, not just a pile of files": restore re-derives the state and must
// match the manifest, or it fails loudly. Above the Freeze Surface; reuses the proven open() recovery.
//
// Out of scope (post-1.9 operational features, deliberately not here): incremental backup, remote
// storage, archival, encryption, backup versioning.

import fs from "node:fs";
import path from "node:path";
import { decodeSnapshot, SnapshotCorruptionError } from "./snapshot.js";
import { listSnapshots } from "./snapshot-store.js";
import { OvtNode, type RecoveryMode } from "./persistent-node.js";

export const BACKUP_SCHEMA_VERSION = 1;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export interface BackupManifest {
  readonly backup_schema_version: number;
  readonly created_at: string;
  readonly wal_size_bytes: number; // the durable WAL prefix captured (consistency boundary)
  readonly snapshots: ReadonlyArray<{ file: string; covered_tick: string; wal_offset: string }>;
  readonly operational: { readonly snapshot_cadence?: number }; // recovery settings / metadata
  // the expected state this backup represents — restore re-derives and must match (byte-for-byte):
  readonly expected: {
    readonly state_root: string;
    readonly global_root: string;
    readonly event_count: number;
    readonly last_event_hash: string;
    readonly committed_ticks: number;
    // and the recovery path restore is expected to take when the snapshot is intact:
    readonly recovery_mode: RecoveryMode;
    readonly covered_tick: string;
    readonly wal_offset: string;
  };
}

const SNAP_RE = /^snapshot-\d+\.json$/;
const paths = (dir: string) => ({ genesis: path.join(dir, "genesis.json"), wal: path.join(dir, "wal.ndjson"), manifest: path.join(dir, "backup-manifest.json") });

function copyPrefix(srcFile: string, destFile: string, bytes: number): void {
  if (bytes <= 0) return void fs.writeFileSync(destFile, "");
  const fd = fs.openSync(srcFile, "r");
  try {
    const buf = Buffer.allocUnsafe(bytes);
    fs.readSync(fd, buf, 0, bytes, 0);
    fs.writeFileSync(destFile, buf);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Capture a CONSISTENT backup of a (quiescent) node directory into `destDir`. Captures the durable WAL
 * prefix, every snapshot at-or-below it, genesis, and a manifest of the expected state (computed by
 * opening the captured set, so the manifest == what restore will produce). Returns the manifest.
 */
export function backupNode(srcDir: string, destDir: string, opts?: { snapshotCadence?: number }): BackupManifest {
  const s = paths(srcDir);
  if (!fs.existsSync(s.genesis)) throw new BackupError(`source has no genesis.json: ${srcDir}`);
  if (!fs.existsSync(s.wal)) throw new BackupError(`source has no wal.ndjson: ${srcDir}`);

  const walSize = fs.statSync(s.wal).size; // the durable prefix to capture (consistency boundary)
  fs.mkdirSync(destDir, { recursive: true });
  const d = paths(destDir);
  fs.copyFileSync(s.genesis, d.genesis);
  copyPrefix(s.wal, d.wal, walSize);

  // include every snapshot whose wal_offset ≤ the captured WAL (never an ahead-of-WAL snapshot)
  const included: Array<{ file: string; covered_tick: bigint; wal_offset: bigint }> = [];
  for (const entry of listSnapshots(srcDir)) {
    let body;
    try {
      body = decodeSnapshot(fs.readFileSync(entry.file, "utf8"));
    } catch {
      continue; // checksum-bad snapshot: leave it out of the backup (WAL is the truth)
    }
    if (body.wal_offset > BigInt(walSize)) continue;
    const base = path.basename(entry.file);
    fs.copyFileSync(entry.file, path.join(destDir, base));
    included.push({ file: base, covered_tick: body.covered_tick, wal_offset: body.wal_offset });
  }

  // compute the expected state by opening the CAPTURED set (so the manifest is the backup's own truth)
  const node = OvtNode.open(destDir);
  const o = node.observe();
  const coveredTick = o.committedTicks - o.recoveredTailTicks;
  const latest = included.sort((a, b) => (a.covered_tick < b.covered_tick ? 1 : -1))[0];
  const manifest: BackupManifest = {
    backup_schema_version: BACKUP_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    wal_size_bytes: walSize,
    snapshots: included.map((x) => ({ file: x.file, covered_tick: x.covered_tick.toString(), wal_offset: x.wal_offset.toString() })),
    operational: { snapshot_cadence: opts?.snapshotCadence },
    expected: {
      state_root: o.stateRoot,
      global_root: o.globalRoot,
      event_count: o.eventCount,
      last_event_hash: o.lastEventHash,
      committed_ticks: o.committedTicks,
      recovery_mode: o.recoveryMode,
      covered_tick: String(coveredTick),
      wal_offset: latest ? latest.wal_offset.toString() : "0",
    },
  };
  fs.writeFileSync(d.manifest, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/**
 * Restore a backup into a fresh `destDir` and VERIFY it. Hard failures (BackupError): a missing
 * manifest / genesis / WAL, an unsupported schema, or a restored state that does not match the manifest
 * (an internally-inconsistent backup). A checksum-bad snapshot is NOT fatal — open() falls back to the
 * WAL (Rule 1); the state still matches the manifest, so the restore succeeds via full replay. Returns
 * the recovered node (its `recoveryMode()` reveals whether the snapshot path or the WAL fallback was used).
 */
export function restoreNode(backupDir: string, destDir: string): OvtNode {
  const b = paths(backupDir);
  if (!fs.existsSync(b.manifest)) throw new BackupError(`backup has no manifest: ${backupDir}`);
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(b.manifest, "utf8")) as BackupManifest;
  } catch {
    throw new BackupError("backup manifest is not valid JSON");
  }
  if (manifest.backup_schema_version !== BACKUP_SCHEMA_VERSION) throw new BackupError(`unsupported backup_schema_version ${String(manifest.backup_schema_version)}`);
  if (!fs.existsSync(b.genesis)) throw new BackupError("backup is missing genesis.json");
  if (!fs.existsSync(b.wal)) throw new BackupError("backup is missing wal.ndjson");

  fs.mkdirSync(destDir, { recursive: true });
  const d = paths(destDir);
  fs.copyFileSync(b.genesis, d.genesis);
  fs.copyFileSync(b.wal, d.wal);
  for (const name of fs.readdirSync(backupDir)) if (SNAP_RE.test(name)) fs.copyFileSync(path.join(backupDir, name), path.join(destDir, name));

  let node: OvtNode;
  try {
    node = OvtNode.open(destDir);
  } catch (e) {
    if (e instanceof SnapshotCorruptionError) throw new BackupError(`restore aborted: ${e.message}`);
    throw e;
  }

  // consistency: the restored state MUST equal the manifest (else the backup set is internally incompatible)
  const o = node.observe();
  const x = manifest.expected;
  if (o.stateRoot !== x.state_root || o.globalRoot !== x.global_root || o.eventCount !== x.event_count || o.lastEventHash !== x.last_event_hash || o.committedTicks !== x.committed_ticks) {
    throw new BackupError(`restored state does not match the manifest (inconsistent backup): state_root ${o.stateRoot} vs ${x.state_root}`);
  }
  return node;
}
