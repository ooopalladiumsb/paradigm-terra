/**
 * L2.5 — Anchor index behavior + the Framing A invariant ("indexes facts, never verifies consensus").
 * @ton/sandbox: deploy → owner records an anchor fact (version → state_root/tx) → read it back
 * byte-identically → latestVersion tracks → idempotent on count → non-owner aborts (401) → unknown op
 * aborts (0xffff). The contract stores the AnchorRecord verbatim and contains NO op that re-derives or
 * verifies a STATE_ROOT — it indexes observed facts, it does not bless them. Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { anchorRecordToCell, cellToAnchorRecord, type AnchorRecord } from "../src/anchor-record.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "anchor-index.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_RECORD_ANCHOR = 0x414e4301;
const initialData = (owner: Address) => beginCell().storeAddress(owner).storeUint(0n, 64).storeUint(0, 32).storeMaybeRef(null).endCell();
const recordBody = (version: bigint, rec: AnchorRecord) =>
  beginCell().storeUint(OP_RECORD_ANCHOR, 32).storeUint(version, 64).storeRef(anchorRecordToCell(rec)).endCell();
// the real PP#4-B anchor as a sample fact
const PP4B: AnchorRecord = { stateRoot: 0x4a14f8f11f37657e62aa6670822a18544fe1fea560aac17f16cd9234efc4d4f0n, txHash: 0x7aaabb93ce1e4fd73bac455be6a0b51e02356a8bebd7f323e65db625b9c6f786n, lt: 76074641000001n, recordedAt: 1781247577 };
const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L2.5: owner records an anchor fact; getAnchor reads it back byte-identically; latestVersion tracks", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const V = 2n;
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: recordBody(V, PP4B) });

  assert.equal((await bc.runGetMethod(addr, "anchorCount", [])).stackReader.readBigNumber(), 1n);
  assert.equal((await bc.runGetMethod(addr, "latestVersion", [])).stackReader.readBigNumber(), V, "latestVersion tracks the highest version");
  assert.equal((await bc.runGetMethod(addr, "hasAnchor", [{ type: "int", value: V }])).stackReader.readBigNumber(), -1n);
  const stored = (await bc.runGetMethod(addr, "getAnchor", [{ type: "int", value: V }])).stackReader.readCell();
  assert.deepEqual(cellToAnchorRecord(stored), PP4B, "anchor fact stored verbatim (indexes, never verifies)");
});

test("L2.5: many versions index independently; latestVersion is the max, re-record is idempotent on count", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: recordBody(5n, { ...PP4B, recordedAt: 1 }) });
  await owner.send({ to: addr, value: toNano("0.1"), body: recordBody(3n, { ...PP4B, recordedAt: 2 }) }); // lower version
  await owner.send({ to: addr, value: toNano("0.1"), body: recordBody(5n, { ...PP4B, recordedAt: 3 }) }); // re-record v5
  assert.equal((await bc.runGetMethod(addr, "anchorCount", [])).stackReader.readBigNumber(), 2n, "two distinct versions");
  assert.equal((await bc.runGetMethod(addr, "latestVersion", [])).stackReader.readBigNumber(), 5n, "latestVersion stays the max, not the last written");
  assert.equal(cellToAnchorRecord((await bc.runGetMethod(addr, "getAnchor", [{ type: "int", value: 5n }])).stackReader.readCell()).recordedAt, 3, "latest record for v5 wins");
});

test("L2.5 invariant: a NON-owner cannot record an anchor (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: recordBody(1n, PP4B) }); // deploy
  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: recordBody(9n, PP4B) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner record aborts 401");
  assert.equal((await bc.runGetMethod(addr, "anchorCount", [])).stackReader.readBigNumber(), 1n, "no anchor recorded by a non-owner");
});

test("L2.5 invariant: no verify/re-derive op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: recordBody(1n, PP4B) }); // deploy
  // there is no "verify_anchor", "rederive_root", "prove" op — verification is off-chain only.
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x76726679, 32).endCell() });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden verification logic)");
});
