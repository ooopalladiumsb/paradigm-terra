/**
 * L2.2 — Treasury view behavior + the Framing A invariant ("Treasury observes, never settles").
 * @ton/sandbox: deploy → owner writes an accounting snapshot → read it back → idempotent re-write →
 * non-owner aborts (401) → unknown op aborts (0xffff). The contract stores every figure VERBATIM and
 * performs NO arithmetic — proven by setting a nav unrelated to fund+fees and reading it back unchanged.
 * Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "treasury.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_SET_SNAPSHOT = 0x54525301;

interface Snapshot { version: bigint; nav: bigint; developerFund: bigint; collectedFees: bigint; }

const initialData = (owner: Address) =>
  beginCell().storeAddress(owner).storeUint(0n, 64).storeUint(0n, 256).storeCoins(0n).storeCoins(0n).endCell();

const setSnapshotBody = (s: Snapshot) =>
  beginCell().storeUint(OP_SET_SNAPSHOT, 32).storeUint(s.version, 64).storeUint(s.nav, 256).storeCoins(s.developerFund).storeCoins(s.collectedFees).endCell();

async function readSnapshot(bc: Blockchain, addr: Address): Promise<Snapshot> {
  const n = async (m: string) => (await bc.runGetMethod(addr, m, [])).stackReader.readBigNumber();
  return { version: await n("version"), nav: await n("nav"), developerFund: await n("developerFund"), collectedFees: await n("collectedFees") };
}

const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L2.2: owner writes an accounting snapshot; getters read it back exactly", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);

  const snap: Snapshot = { version: 1280n, nav: 123_456_789n, developerFund: toNano("42.5"), collectedFees: toNano("3.25") };
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: setSnapshotBody(snap) });
  assert.deepEqual(await readSnapshot(bc, addr), snap, "snapshot mirrored verbatim");
});

test("L2.2: re-writing the same snapshot is idempotent; a newer version overwrites", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const s1: Snapshot = { version: 1n, nav: 100n, developerFund: toNano("1"), collectedFees: toNano("0.1") };
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: setSnapshotBody(s1) });
  await owner.send({ to: addr, value: toNano("0.1"), body: setSnapshotBody(s1) }); // idempotent
  assert.deepEqual(await readSnapshot(bc, addr), s1, "re-applying the same snapshot leaves state identical");

  const s2: Snapshot = { version: 2n, nav: 200n, developerFund: toNano("2"), collectedFees: toNano("0.2") };
  await owner.send({ to: addr, value: toNano("0.1"), body: setSnapshotBody(s2) });
  assert.deepEqual(await readSnapshot(bc, addr), s2, "a newer snapshot overwrites");
});

test("L2.2 invariant: the contract STORES, it does not COMPUTE (nav is verbatim, not derived from fund+fees)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  // nav is deliberately NOT fund+fees — a settling contract would recompute it; an observational one stores it.
  const snap: Snapshot = { version: 9n, nav: 999_999_999n, developerFund: toNano("10"), collectedFees: toNano("5") };
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: setSnapshotBody(snap) });
  const back = await readSnapshot(bc, addr);
  assert.equal(back.nav, 999_999_999n, "nav is stored verbatim, never recomputed from balances");
  assert.notEqual(back.nav, back.developerFund + back.collectedFees, "nav is NOT derived (observes, never settles)");
});

test("L2.2 invariant: a NON-owner cannot write the projection (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: setSnapshotBody({ version: 1n, nav: 1n, developerFund: 0n, collectedFees: 0n }) }); // deploy

  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: setSnapshotBody({ version: 5n, nav: 5n, developerFund: toNano("9"), collectedFees: 0n }) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner snapshot write aborts 401");
  assert.equal((await readSnapshot(bc, addr)).version, 1n, "snapshot unchanged after a non-owner attempt");
});

test("L2.2 invariant: no settlement/compute op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: setSnapshotBody({ version: 1n, nav: 1n, developerFund: 0n, collectedFees: 0n }) }); // deploy
  // there is no "distribute", "settle", "recompute_nav" op — the contract reflects, it does not settle.
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x57534554, 32).endCell() });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden settlement logic)");
});
