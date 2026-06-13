/**
 * L2.1 — Registry read-model behavior + the Framing A invariant (observational only). @ton/sandbox:
 * deploy → owner upserts an agent projection → read it back byte-identically → registry-wide mcp_schema_hash
 * mirrors → a NON-owner write aborts (401) → an unknown op aborts (0xffff). The contract stores the
 * AgentRecord verbatim and never derives it — the read-model invariant. Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { agentRecordToCell, cellToAgentRecord, type AgentRecord } from "../src/agent-record.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "registry.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_UPSERT_AGENT = 0x52454701;
const OP_SET_MCP_HASH = 0x52454702;

const initialData = (owner: Address) =>
  beginCell().storeAddress(owner).storeUint(0n, 256).storeUint(0, 32).storeMaybeRef(null).endCell();

const upsertBody = (agentId: bigint, rec: AgentRecord) =>
  beginCell().storeUint(OP_UPSERT_AGENT, 32).storeUint(agentId, 256).storeRef(agentRecordToCell(rec)).endCell();

const sampleRecord = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  operatorPubkey: 0x1111n, ownersHash: 0xaaaan, threshold: 2, scopesHash: 0xbbbbn, recordVersion: 7, ...over,
});

async function deploy(bc: Blockchain, owner: Address) {
  const data = initialData(owner);
  const addr = contractAddress(0, { code, data });
  return { addr, data };
}

test("L2.1: owner upserts an agent projection; getAgent reads it back byte-identically", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = await deploy(bc, owner.address);

  const AGENT = 0xa9efn;
  const rec = sampleRecord({ operatorPubkey: 0xdeadbeefn, threshold: 3, recordVersion: 42 });
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(AGENT, rec) });

  assert.equal((await bc.runGetMethod(addr, "agentCount", [])).stackReader.readBigNumber(), 1n, "agentCount == 1");
  assert.equal((await bc.runGetMethod(addr, "hasAgent", [{ type: "int", value: AGENT }])).stackReader.readBigNumber(), -1n, "hasAgent == true");
  const stored = (await bc.runGetMethod(addr, "getAgent", [{ type: "int", value: AGENT }])).stackReader.readCell();
  assert.deepEqual(cellToAgentRecord(stored), rec, "stored record is byte-identical to the projected record (observational: stored verbatim)");
});

test("L2.1: registry-wide mcp_schema_hash mirrors (owner-set), and an upsert is idempotent on count", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = await deploy(bc, owner.address);

  const MCP = 0xcb133fa7n;
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: beginCell().storeUint(OP_SET_MCP_HASH, 32).storeUint(MCP, 256).endCell() });
  assert.equal((await bc.runGetMethod(addr, "mcpSchemaHash", [])).stackReader.readBigNumber(), MCP, "mcp_schema_hash mirrored");

  const AGENT = 0x1n;
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(AGENT, sampleRecord({ recordVersion: 1 })) });
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(AGENT, sampleRecord({ recordVersion: 2 })) }); // update same key
  assert.equal((await bc.runGetMethod(addr, "agentCount", [])).stackReader.readBigNumber(), 1n, "re-upserting the same agent does not double-count");
  const stored = cellToAgentRecord((await bc.runGetMethod(addr, "getAgent", [{ type: "int", value: AGENT }])).stackReader.readCell());
  assert.equal(stored.recordVersion, 2, "the latest projection wins");
});

test("L2.1 invariant: a NON-owner cannot write the projection (Framing A — observational, owner-gated)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = await deploy(bc, owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: beginCell().storeUint(OP_SET_MCP_HASH, 32).storeUint(1n, 256).endCell() }); // deploy

  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: upsertBody(0x5n, sampleRecord()) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner upsert aborts 401");
  assert.equal((await bc.runGetMethod(addr, "agentCount", [])).stackReader.readBigNumber(), 0n, "no agent recorded by a non-owner");
});

test("L2.1 invariant: no consensus-deriving op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = await deploy(bc, owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: beginCell().storeUint(OP_SET_MCP_HASH, 32).storeUint(1n, 256).endCell() }); // deploy

  // there is no "validate", "register", "decide" op — the contract reflects, it does not compute.
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x12345678, 32).endCell() });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden consensus logic)");
});
