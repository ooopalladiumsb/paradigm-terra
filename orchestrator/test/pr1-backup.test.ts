/**
 * PR-1.7 — backup / restore. The invariant (Backup Equivalence): restore(backup(node@t)) == node@t,
 * into a FRESH directory, byte-for-byte on STATE_ROOT / GLOBAL_ROOT / EVENT_COUNT / LAST_EVENT_HASH
 * (the state), and matching the manifest on RECOVERY_MODE / COVERED_TICK / WAL_OFFSET (the recovery
 * path). Plus four negative controls so a backup is a CONSISTENT state, not just a pile of files:
 *   missing WAL → fail · missing genesis → fail · corrupted snapshot → recover via WAL ·
 *   internally-inconsistent backup → fail.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import type { Submission } from "../src/index.js";
import { OvtNode } from "../src/node/persistent-node.js";
import { decodeSnapshot } from "../src/node/snapshot.js";
import { backupNode, BackupError, restoreNode, type BackupManifest } from "../src/node/backup.js";

const A = "0:" + "cc".repeat(32);
const okTrace: ExecutionTrace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {} as Json, stateAfter: {} as Json, operatorSigPresent: true, ownerSigPresent: true };
function fundedGenesis(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> } };
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g as unknown as State;
}
function sendSub(nonce: bigint): Submission {
  return { cal: { action: "wallet.send_ton", agent_id: A, nonce, expiration_tick: 10_000_000n, preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } }, invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }] } as Json, trace: okTrace };
}
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pr1-7-${tag}-`));
const latestSnapshotWalOffset = (dir: string): string => {
  const files = fs.readdirSync(dir).filter((n) => /^snapshot-(\d+)\.json$/.test(n)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  return decodeSnapshot(fs.readFileSync(path.join(dir, files[0]!), "utf8")).wal_offset.toString();
};

// one source node: 25 committed ticks, cadence-10 snapshots at 10 and 20 ⇒ a non-empty tail (5)
const srcDir = tmp("src");
const srcNode = OvtNode.create(srcDir, fundedGenesis());
for (let i = 0; i < 25; i++) { srcNode.submit([sendSub(BigInt(i + 1))]); srcNode.maybeSnapshot(10); }
const srcObs = srcNode.observe();

test("Backup Equivalence: restore into a fresh dir reproduces all 7 quantities", () => {
  const bdir = tmp("bk");
  const manifest = backupNode(srcDir, bdir, { snapshotCadence: 10 });
  const rdir = tmp("rs");
  const restored = restoreNode(bdir, rdir);
  const r = restored.observe();

  // state — restore == source, byte-for-byte
  assert.equal(r.stateRoot, srcObs.stateRoot, "STATE_ROOT");
  assert.equal(r.globalRoot, srcObs.globalRoot, "GLOBAL_ROOT");
  assert.equal(r.eventCount, srcObs.eventCount, "EVENT_COUNT");
  assert.equal(r.lastEventHash, srcObs.lastEventHash, "LAST_EVENT_HASH");
  assert.equal(r.committedTicks, srcObs.committedTicks, "committed ticks");

  // recovery path — restore == the backup manifest (the snapshot path was used as recorded)
  assert.equal(r.recoveryMode, "SNAPSHOT_TAIL", "RECOVERY_MODE: used the snapshot");
  assert.equal(r.recoveryMode, manifest.expected.recovery_mode);
  assert.equal(String(r.committedTicks - r.recoveredTailTicks), manifest.expected.covered_tick, "COVERED_TICK");
  assert.equal(manifest.expected.covered_tick, "20");
  assert.equal(latestSnapshotWalOffset(rdir), manifest.expected.wal_offset, "WAL_OFFSET matches the manifest");

  for (const d of [bdir, rdir]) fs.rmSync(d, { recursive: true, force: true });
});

test("negative: missing WAL in the backup → restore fails", () => {
  const bdir = tmp("noWal");
  backupNode(srcDir, bdir);
  fs.rmSync(path.join(bdir, "wal.ndjson"));
  assert.throws(() => restoreNode(bdir, tmp("rs")), BackupError, "missing WAL aborts restore");
  fs.rmSync(bdir, { recursive: true, force: true });
});

test("negative: missing genesis in the backup → restore fails", () => {
  const bdir = tmp("noGen");
  backupNode(srcDir, bdir);
  fs.rmSync(path.join(bdir, "genesis.json"));
  assert.throws(() => restoreNode(bdir, tmp("rs")), BackupError, "missing genesis aborts restore");
  fs.rmSync(bdir, { recursive: true, force: true });
});

test("negative: missing manifest → restore fails (a backup is not just files)", () => {
  const bdir = tmp("noMan");
  backupNode(srcDir, bdir);
  fs.rmSync(path.join(bdir, "backup-manifest.json"));
  assert.throws(() => restoreNode(bdir, tmp("rs")), BackupError);
  fs.rmSync(bdir, { recursive: true, force: true });
});

test("negative: corrupted snapshots → restore SUCCEEDS via the WAL (full replay), same state", () => {
  const bdir = tmp("corruptSnap");
  backupNode(srcDir, bdir);
  // corrupt EVERY snapshot's bytes (one corrupt + a valid older one would just roll back — see the
  // crash matrix; here we force the WAL fallback the negative control is about)
  for (const snap of fs.readdirSync(bdir).filter((n) => /^snapshot-\d+\.json$/.test(n))) {
    const p = path.join(bdir, snap);
    const bytes = fs.readFileSync(p, "utf8");
    const idx = bytes.indexOf('"body":"') + 40;
    fs.writeFileSync(p, bytes.slice(0, idx) + (bytes[idx] === "a" ? "b" : "a") + bytes.slice(idx + 1));
  }

  const rdir = tmp("rs");
  const restored = restoreNode(bdir, rdir); // must NOT throw — every snapshot bad ⇒ fall back to the WAL
  assert.equal(restored.stateRoot(), srcObs.stateRoot, "state still matches (recovered via WAL)");
  assert.equal(restored.recoveryMode(), "FULL_REPLAY", "all snapshots corrupt ⇒ full WAL replay");
  for (const d of [bdir, rdir]) fs.rmSync(d, { recursive: true, force: true });
});

test("negative: internally-inconsistent backup (tampered manifest state) → restore fails", () => {
  const bdir = tmp("inconsistent");
  backupNode(srcDir, bdir);
  const mp = path.join(bdir, "backup-manifest.json");
  const m = JSON.parse(fs.readFileSync(mp, "utf8")) as BackupManifest;
  const tampered = { ...m, expected: { ...m.expected, state_root: "0x" + "de".repeat(32) } };
  fs.writeFileSync(mp, JSON.stringify(tampered));
  assert.throws(() => restoreNode(bdir, tmp("rs")), BackupError, "restored state != manifest ⇒ inconsistent backup");
  fs.rmSync(bdir, { recursive: true, force: true });
});
