/**
 * L3.1 — Governance view behavior + the Framing A invariant ("reflects tallies, never votes").
 * @ton/sandbox: deploy → owner upserts a proposal projection → read it back byte-identically → params
 * mirror → non-owner aborts (401) → unknown op aborts (0xffff). The contract stores the decided tally
 * VERBATIM and contains NO op that tallies a vote or decides a status — it reflects, it does not govern.
 * Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { proposalRecordToCell, cellToProposalRecord, PROPOSAL_PASSED, type ProposalRecord } from "../src/proposal-record.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "governance-view.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_UPSERT_PROPOSAL = 0x47565001;
const OP_SET_PARAMS = 0x47565002;
const initialData = (owner: Address) => beginCell().storeAddress(owner).storeUint(0n, 64).storeUint(0, 32).storeMaybeRef(null).endCell();
const upsertBody = (id: bigint, r: ProposalRecord) => beginCell().storeUint(OP_UPSERT_PROPOSAL, 32).storeUint(id, 64).storeRef(proposalRecordToCell(r)).endCell();
const sample = (over: Partial<ProposalRecord> = {}): ProposalRecord => ({ tallyFor: 3162n, tallyAgainst: 2236n, status: PROPOSAL_PASSED, tier: 1, version: 89, ...over });
const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L3.1: owner upserts a proposal projection; getProposal reads it back byte-identically", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const P = 7n;
  const rec = sample({ tallyFor: 100n, tallyAgainst: 40n, tier: 2, version: 91 });
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(P, rec) });
  assert.equal((await bc.runGetMethod(addr, "proposalCount", [])).stackReader.readBigNumber(), 1n);
  assert.equal((await bc.runGetMethod(addr, "hasProposal", [{ type: "int", value: P }])).stackReader.readBigNumber(), -1n);
  const stored = (await bc.runGetMethod(addr, "getProposal", [{ type: "int", value: P }])).stackReader.readCell();
  assert.deepEqual(cellToProposalRecord(stored), rec, "proposal record stored verbatim (reflects the decided tally)");
});

test("L3.1: chain-wide gov params mirror (owner-set); re-upsert is idempotent on count", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: beginCell().storeUint(OP_SET_PARAMS, 32).storeUint(1000n, 64).endCell() });
  assert.equal((await bc.runGetMethod(addr, "gasPriceNanoPtraPerUnit", [])).stackReader.readBigNumber(), 1000n, "gas price param mirrored");
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(1n, sample({ version: 1 })) });
  await owner.send({ to: addr, value: toNano("0.1"), body: upsertBody(1n, sample({ version: 2 })) });
  assert.equal((await bc.runGetMethod(addr, "proposalCount", [])).stackReader.readBigNumber(), 1n, "same proposal not double-counted");
});

test("L3.1 invariant: reflects, never votes — an inconsistent tally/status is stored VERBATIM (not recomputed)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  // status=PASSED but tallyFor < tallyAgainst — a voting contract would reject/flip; a read-model stores it as-is.
  const rec = sample({ status: PROPOSAL_PASSED, tallyFor: 10n, tallyAgainst: 999n });
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: upsertBody(5n, rec) });
  const stored = cellToProposalRecord((await bc.runGetMethod(addr, "getProposal", [{ type: "int", value: 5n }])).stackReader.readCell());
  assert.equal(stored.status, PROPOSAL_PASSED, "status stored verbatim");
  assert.ok(stored.tallyFor < stored.tallyAgainst, "the contract did NOT recompute the outcome from the tally — it reflects the off-chain decision");
});

test("L3.1 invariant: a NON-owner cannot write the projection (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(1n, sample()) });
  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: upsertBody(2n, sample()) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner upsert aborts 401");
  assert.equal((await bc.runGetMethod(addr, "proposalCount", [])).stackReader.readBigNumber(), 1n, "no proposal recorded by a non-owner");
});

test("L3.1 invariant: no vote/tally/finalize op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: upsertBody(1n, sample()) });
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x766f7465, 32).endCell() }); // "vote"
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden voting/tally logic)");
});
