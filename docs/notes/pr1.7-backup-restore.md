# PR-1.7 — Backup / Restore

**Date:** 2026-06-08 · Branch `post-freeze/pr1` · Operational hardening on top of the proven recovery
pipeline. A backup is a CONSISTENT capture of operational truth; restore reproduces it in a fresh
directory and VERIFIES it. Above the Freeze Surface; reuses `OvtNode.open()`.

## What a backup is

A consistent set, plus a manifest that makes it a *state*, not a pile of files (`src/node/backup.ts`):
- `genesis.json`;
- the **durable WAL prefix** (captured at a byte boundary — `wal_size_bytes`);
- every snapshot with `wal_offset ≤ wal_size_bytes` (never an ahead-of-WAL snapshot; checksum-bad ones
  are skipped — the WAL is the truth);
- operational metadata (snapshot cadence);
- `backup-manifest.json` — the **expected** state (state_root, global_root, event_count,
  last_event_hash, committed_ticks) and the expected recovery path (recovery_mode, covered_tick,
  wal_offset), computed by opening the captured set so the manifest *is* the backup's own truth.

## Backup Equivalence (the invariant)

```
restore(backup(node@t))  ==  node@t       (into a fresh directory)
```
byte-for-byte on the state — `STATE_ROOT, GLOBAL_ROOT, EVENT_COUNT, LAST_EVENT_HASH` (+ committed
ticks) — and matching the manifest on the recovery path — `RECOVERY_MODE, COVERED_TICK, WAL_OFFSET`.
`restoreNode()` re-derives the state from the copied files and **hard-fails** (`BackupError`) if it does
not match the manifest: a backup that restores to a different state is rejected, not silently accepted.

## Negative controls (a backup is consistent, or it fails)

| scenario | behaviour |
|---|---|
| missing WAL | `BackupError` (restore aborts) |
| missing genesis | `BackupError` |
| missing manifest | `BackupError` |
| corrupted snapshot(s) | recover via the WAL — full replay, state still matches (no hard fail) |
| internally-inconsistent backup (tampered manifest / mismatched files) | `BackupError` (restored state ≠ manifest) |

The corrupted-snapshot case is graceful degradation (Rule 1: a snapshot is a discardable accelerator);
with ≥2 retained snapshots a single corrupt one rolls back to the previous, all corrupt falls back to
the full WAL — either way the state is exact. The inconsistent-backup case is the one that proves the
manifest earns its keep: it catches a backup whose files do not agree with its recorded state.

## DoD gates (`test/pr1-backup.test.ts`, 6/6)

Backup Equivalence on all 7 quantities (restore into a fresh dir; recovery via SNAPSHOT_TAIL with the
recorded covered_tick=20 / wal_offset), plus the five negative controls above. Suite 81/81, typecheck
clean. Scope deliberately excludes incremental/remote/archival/encryption/versioned backup (post-1.9).

## Position
```
Operational Kernel ✅ → Metrics ✅ → Monitoring ✅ → Alerting ✅ → Backup/Restore ✅ (this)
  → Live Observer (1.8, H3.5-live)  → Soak (1.9)
```
Two readiness milestones remain: PR-1.8 (external live observer, closes H3.5-live) and PR-1.9 (the
soak that surfaces long-run effects — memory, cadence, tail, retention).

## Related
- `src/node/backup.ts` — backupNode / restoreNode / BackupManifest / BackupError.
- `src/node/persistent-node.ts` — `open()` (reused) + `observe()` (now carries `lastEventHash`).
- `pr1.2c-snapshot-design.md` — the snapshot rules (Truth / ahead-of-WAL) the backup capture honours.
