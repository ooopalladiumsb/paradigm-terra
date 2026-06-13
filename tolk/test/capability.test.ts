/**
 * L2.4 — Capability view behavior + the Framing A invariant ("reflects grants, never authorizes").
 * @ton/sandbox: deploy → owner upserts a capability projection → read it back byte-identically →
 * idempotent on count → non-owner aborts (401) → unknown op aborts (0xffff). The contract stores the
 * CapabilityRecord verbatim and contains NO op that decides access / checks a scope / computes a
 * permission — it grants nothing, it mirrors decided grants. Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { capabilityRecordToCell, cellToCapabilityRecord, type CapabilityRecord } from "../src/capability-record.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "capability.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_UPSERT_CAPABILITY = 0x43415001;
const initialData = (owner: Address) => beginCell().storeAddress(owner).storeUint(0, 32).storeMaybeRef(null).endCell();
const upsertBody = (agentId: bigint, rec: CapabilityRecord) =>
  beginCell().storeUint(OP_UPSERT_CAPABILITY, 32).storeUint(agentId, 256).storeRef(capabilityRecordToCell(rec)).endCell();
const sample = (over: Partial<CapabilityRecord> = {}): CapabilityRecord => ({ scopesHash: 0x7a0n, profileHash: 0x9b0n, version: 3, ...over });
const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L2.4: owner upserts a capability projection; getCapability reads it back byte-identically", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const AGENT = 0xa9efn;
  const rec = sample({ scopesHash: 0xdeadn, profileHash: 0xbeefn, version: 12 });
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(AGENT, rec) });

  assert.equal((await bc.runGetMethod(addr, "agentCount", [])).stackReader.readBigNumber(), 1n);
  assert.equal((await bc.runGetMethod(addr, "hasCapability", [{ type: "int", value: AGENT }])).stackReader.readBigNumber(), -1n, "hasCapability == true");
  const stored = (await bc.runGetMethod(addr, "getCapability", [{ type: "int", value: AGENT }])).stackReader.readCell();
  assert.deepEqual(cellToCapabilityRecord(stored), rec, "capability record stored verbatim (reflects grants)");
});

test("L2.4: re-upserting the same agent updates the grant and does not double-count", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const AGENT = 0x1n;
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(AGENT, sample({ version: 1 })) });
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(AGENT, sample({ version: 2, scopesHash: 0xfeedn })) });
  assert.equal((await bc.runGetMethod(addr, "agentCount", [])).stackReader.readBigNumber(), 1n, "same agent not double-counted");
  const stored = cellToCapabilityRecord((await bc.runGetMethod(addr, "getCapability", [{ type: "int", value: AGENT }])).stackReader.readCell());
  assert.equal(stored.scopesHash, 0xfeedn, "the latest projected grant wins");
});

test("L2.4 invariant: a NON-owner cannot write the projection (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(0x1n, sample()) }); // deploy
  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: upsertBody(0x5n, sample()) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner upsert aborts 401");
  assert.equal((await bc.runGetMethod(addr, "agentCount", [])).stackReader.readBigNumber(), 1n, "no grant recorded by a non-owner");
});

test("L2.4 invariant: no authorization op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(0x1n, sample()) }); // deploy
  // there is no "authorize", "check_scope", "can_perform" op — access decisions are off-chain only.
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x61757468, 32).endCell() });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden authorization logic)");
});
