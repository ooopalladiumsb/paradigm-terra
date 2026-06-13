/**
 * L3.3 — PTRA view behavior + the Framing A invariant ("reflects balances, never mints or stakes").
 * @ton/sandbox: deploy → owner upserts an account projection → read it back byte-identically → re-upsert
 * (latest settled balance wins, no minting/accrual) → non-owner aborts (401) → unknown op aborts (0xffff).
 * The contract stores the settled balance/stake VERBATIM and contains NO mint/transfer/stake/reward op.
 * Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { ptraRecordToCell, cellToPtraRecord, type PtraRecord } from "../src/ptra-record.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "ptra-view.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_UPSERT_ACCOUNT = 0x50545201;
const ACC = 0xa9efn;
const initialData = (owner: Address) => beginCell().storeAddress(owner).storeUint(0, 32).storeMaybeRef(null).endCell();
const upsertBody = (id: bigint, r: PtraRecord) => beginCell().storeUint(OP_UPSERT_ACCOUNT, 32).storeUint(id, 256).storeRef(ptraRecordToCell(r)).endCell();
const sample = (over: Partial<PtraRecord> = {}): PtraRecord => ({ balance: toNano("847.3"), staked: toNano("100"), rewardsAccrued: toNano("1.5"), version: 1247, ...over });
const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L3.3: owner upserts an account projection; getAccount reads it back byte-identically", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const rec = sample({ balance: toNano("500"), staked: toNano("250"), rewardsAccrued: toNano("3.25"), version: 99 });
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(ACC, rec) });
  assert.equal((await bc.runGetMethod(addr, "accountCount", [])).stackReader.readBigNumber(), 1n);
  assert.equal((await bc.runGetMethod(addr, "hasAccount", [{ type: "int", value: ACC }])).stackReader.readBigNumber(), -1n);
  const stored = (await bc.runGetMethod(addr, "getAccount", [{ type: "int", value: ACC }])).stackReader.readCell();
  assert.deepEqual(cellToPtraRecord(stored), rec, "account record stored verbatim (reflects the settled balance)");
});

test("L3.3 invariant: reflects, never mints — the latest settled balance REPLACES (no accrual/minting)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(ACC, sample({ balance: toNano("100"), version: 1 })) });
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(ACC, sample({ balance: toNano("90"), version: 2 })) });
  assert.equal((await bc.runGetMethod(addr, "accountCount", [])).stackReader.readBigNumber(), 1n, "same account not double-counted");
  const stored = cellToPtraRecord((await bc.runGetMethod(addr, "getAccount", [{ type: "int", value: ACC }])).stackReader.readCell());
  assert.equal(stored.balance, toNano("90"), "the LATEST settled balance wins verbatim — the contract did NOT add/mint/accrue (a balance can go DOWN, impossible for a minting contract)");
});

test("L3.3 invariant: a NON-owner cannot write an account (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(ACC, sample()) });
  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: upsertBody(0x999n, sample()) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner account write aborts 401");
  assert.equal((await bc.runGetMethod(addr, "accountCount", [])).stackReader.readBigNumber(), 1n, "no account recorded by a non-owner");
});

test("L3.3 invariant: no mint/transfer/stake/claim op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(ACC, sample()) });
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x6d696e74, 32).endCell() }); // "mint"
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden mint/stake logic)");
});
