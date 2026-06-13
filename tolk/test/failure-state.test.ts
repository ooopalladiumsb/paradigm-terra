/**
 * L2.3 — FailureStateManager view behavior + the Framing A invariant ("reflects mode, never transitions").
 * @ton/sandbox: deploy → owner writes a failure-state projection → read back → idempotent rewrite →
 * non-owner aborts (401) → unknown op aborts (0xffff). The contract stores the DECIDED mode verbatim and
 * contains NO transition logic: the stored mode MAY change across writes (NORMAL→BOUNDED), but only because
 * the owner (the off-chain decision) set it — nothing in the contract initiates or infers a transition.
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
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "failure-state.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_SET_FAILURE_STATE = 0x46535401;
const MODE_NORMAL = 0, MODE_BOUNDED = 4;

interface FState { version: bigint; mode: number; isBoundedMode: boolean; captureGuardHash: bigint; }

const initialData = (owner: Address) =>
  beginCell().storeAddress(owner).storeUint(0n, 64).storeUint(0, 8).storeBit(false).storeUint(0n, 256).endCell();

const setBody = (s: FState) =>
  beginCell().storeUint(OP_SET_FAILURE_STATE, 32).storeUint(s.version, 64).storeUint(s.mode, 8).storeBit(s.isBoundedMode).storeUint(s.captureGuardHash, 256).endCell();

async function read(bc: Blockchain, addr: Address): Promise<FState> {
  const n = async (m: string) => (await bc.runGetMethod(addr, m, [])).stackReader.readBigNumber();
  return { version: await n("version"), mode: Number(await n("mode")), isBoundedMode: (await n("isBoundedMode")) !== 0n, captureGuardHash: await n("captureGuardHash") };
}
const deploy = (owner: Address) => { const data = initialData(owner); return { data, addr: contractAddress(0, { code, data }) }; };

test("L2.3: owner writes a failure-state projection; getters read it back exactly", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  const s: FState = { version: 5842n, mode: MODE_BOUNDED, isBoundedMode: true, captureGuardHash: 0xc0ffeen };
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: setBody(s) });
  assert.deepEqual(await read(bc, addr), s, "failure state mirrored verbatim");
});

test("L2.3 invariant: the stored mode MAY change, but the contract NEVER transitions it itself", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);

  // 1) project NORMAL
  await owner.send({ to: addr, value: toNano("0.2"), init: { code, data }, body: setBody({ version: 1n, mode: MODE_NORMAL, isBoundedMode: false, captureGuardHash: 0n }) });
  assert.equal((await read(bc, addr)).mode, MODE_NORMAL, "mode == NORMAL after the owner projected it");

  // 2) project BOUNDED — the value changes ONLY because the owner (off-chain decision) wrote it
  await owner.send({ to: addr, value: toNano("0.1"), body: setBody({ version: 2n, mode: MODE_BOUNDED, isBoundedMode: true, captureGuardHash: 0n }) });
  assert.equal((await read(bc, addr)).mode, MODE_BOUNDED, "mode == BOUNDED only because it was projected — not transitioned by the contract");

  // 3) the contract makes NO inference: project mode=BOUNDED while isBoundedMode=false (deliberately
  //    inconsistent). A deciding contract would 'fix' it; an observational one stores both verbatim.
  await owner.send({ to: addr, value: toNano("0.1"), body: setBody({ version: 3n, mode: MODE_BOUNDED, isBoundedMode: false, captureGuardHash: 0n }) });
  const st = await read(bc, addr);
  assert.equal(st.mode, MODE_BOUNDED, "mode stored verbatim");
  assert.equal(st.isBoundedMode, false, "isBoundedMode is NOT derived from mode — the contract stores decisions, never makes them");
});

test("L2.3 invariant: a NON-owner cannot write the projection (401)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const stranger = await bc.treasury("stranger");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: setBody({ version: 1n, mode: MODE_NORMAL, isBoundedMode: false, captureGuardHash: 0n }) }); // deploy

  const res = await stranger.send({ to: addr, value: toNano("0.1"), body: setBody({ version: 9n, mode: MODE_BOUNDED, isBoundedMode: true, captureGuardHash: 0n }) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner write aborts 401");
  assert.equal((await read(bc, addr)).mode, MODE_NORMAL, "mode unchanged after a non-owner attempt");
});

test("L2.3 invariant: no transition/decision op exists — any unknown op aborts (0xffff)", async () => {
  const bc = await Blockchain.create();
  const owner = await bc.treasury("owner");
  const { addr, data } = deploy(owner.address);
  await owner.send({ to: addr, value: toNano("0.1"), init: { code, data }, body: setBody({ version: 1n, mode: MODE_NORMAL, isBoundedMode: false, captureGuardHash: 0n }) }); // deploy
  // there is no "enter_bounded", "exit_bounded", "trip_capture_guard", "check_thresholds" op.
  const res = await owner.send({ to: addr, value: toNano("0.1"), body: beginCell().storeUint(0x656e7472, 32).endCell() });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff), "unknown op aborts 0xffff (no hidden transition logic)");
});
