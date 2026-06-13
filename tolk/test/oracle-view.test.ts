/**
 * L3.2 — Oracle view behavior + the Framing A invariant ("reflects feeds, never aggregates").
 * @ton/sandbox: deploy → owner upserts a feed projection → read it back byte-identically → re-upsert
 * (latest settled value wins, no aggregation) → non-owner aborts (401) → unknown op aborts (0xffff). The
 * contract stores the settled feed VERBATIM and contains NO op that aggregates submissions or slashes.
 * Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { feedRecordToCell, cellToFeedRecord, type FeedRecord } from "../src/feed-record.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "oracle-view.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_UPSERT_FEED = 0x4f524301;
const TON_USD = 0x746f6e2f757364n; // "ton/usd" as a feed_id
const initialData = (owner: Address) => beginCell().storeAddress(owner).storeUint(0, 32).storeMaybeRef(null).endCell();
const upsertBody = (id: bigint, r: FeedRecord) => beginCell().storeUint(OP_UPSERT_FEED, 32).storeUint(id, 256).storeRef(feedRecordToCell(r)).endCell();
const sample = (over: Partial<FeedRecord> = {}): FeedRecord => ({ value: 6340000n, updatedAtTick: 100n, version: 100, ...over });
const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L3.2: owner upserts a feed projection; getFeed reads it back byte-identically", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const rec = sample({ value: 6340000n, updatedAtTick: 100n, version: 100 });
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(TON_USD, rec) });
  assert.equal((await bc.runGetMethod(addr, "feedCount", [])).stackReader.readBigNumber(), 1n);
  assert.equal((await bc.runGetMethod(addr, "hasFeed", [{ type: "int", value: TON_USD }])).stackReader.readBigNumber(), -1n);
  const stored = (await bc.runGetMethod(addr, "getFeed", [{ type: "int", value: TON_USD }])).stackReader.readCell();
  assert.deepEqual(cellToFeedRecord(stored), rec, "feed record stored verbatim (reflects the settled value)");
});

test("L3.2 invariant: reflects, never aggregates — the latest settled value REPLACES (no median/average)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(TON_USD, sample({ value: 6000000n, version: 1 })) });
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(TON_USD, sample({ value: 7000000n, version: 2 })) });
  assert.equal((await bc.runGetMethod(addr, "feedCount", [])).stackReader.readBigNumber(), 1n, "same feed not double-counted");
  const stored = cellToFeedRecord((await bc.runGetMethod(addr, "getFeed", [{ type: "int", value: TON_USD }])).stackReader.readCell());
  assert.equal(stored.value, 7000000n, "the LATEST settled value wins verbatim — NOT an average/median of 6M and 7M (no aggregation)");
});

test("L3.2 invariant: a NON-owner cannot write a feed (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(TON_USD, sample()) });
  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: upsertBody(0x999n, sample()) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner feed write aborts 401");
  assert.equal((await bc.runGetMethod(addr, "feedCount", [])).stackReader.readBigNumber(), 1n, "no feed recorded by a non-owner");
});

test("L3.2 invariant: no aggregate/slash/force-update op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(TON_USD, sample()) });
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x736c7368, 32).endCell() }); // "slsh"
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden aggregation/slashing logic)");
});
