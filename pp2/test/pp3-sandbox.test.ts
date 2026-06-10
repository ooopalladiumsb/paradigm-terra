/**
 * PP#3-A.2 — offline TVM validation (no network). Runs the J1 publication path against the REAL official
 * standard jetton, executed in @ton/sandbox: deploy minter → mint to operator → send OUR send_jetton
 * TEP-74 body (produced by canonical_to_inner → jettonBodyToCell) to the operator's jetton wallet → the
 * recipient's jetton wallet receives the exact amount. This validates message construction + the ⊆ rule
 * against the known-good contract BEFORE any irreversible testnet broadcast (PP#3-B). Offline.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { canonicalToInner } from "../../orchestrator/dist/w5/canonical-to-inner.js";
import { jettonBodyToCell, type JettonTransferBody } from "../src/ir-to-boc.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "jetton");
const jc = JSON.parse(fs.readFileSync(path.join(SRC, "jetton-compiled.json"), "utf8"));
const minterCode = Cell.fromBase64(jc.minter.codeBoc);
const walletCode = Cell.fromBase64(jc.wallet.codeBoc);

const OP_MINT = 21;
const OP_INTERNAL_TRANSFER = 0x178d4519;

const jettonWalletOf = (owner: Address, master: Address) =>
  contractAddress(0, { code: walletCode, data: beginCell().storeCoins(0).storeAddress(owner).storeAddress(master).storeRef(walletCode).endCell() });

async function readJettonBalance(bc: Blockchain, jw: Address): Promise<bigint> {
  const st = (await bc.getContract(jw)).accountState;
  if (!st || st.type !== "active") return 0n;
  const res = await bc.runGetMethod(jw, "get_wallet_data", []);
  return res.stackReader.readBigNumber(); // balance is the first returned value
}

test("PP#3-A.2: our send_jetton body moves jettons through the real jetton wallet (sandbox)", async () => {
  const bc = await Blockchain.create();
  const operator = await bc.treasury("operator");
  const recipient = await bc.treasury("recipient");

  // minter data: total_supply 0, admin = operator, content, wallet code (mirrors pp3-plan.mjs)
  const content = beginCell().storeUint(0, 8).storeStringTail("PT-TEST-JETTON").endCell();
  const minterData = beginCell().storeCoins(0).storeAddress(operator.address).storeRef(content).storeRef(walletCode).endCell();
  const master = contractAddress(0, { code: minterCode, data: minterData });

  // ── deploy minter + mint 1000 to operator (one admin message: deploy via init, mint body) ──
  const MINT = 1000n;
  const masterMsg = beginCell()
    .storeUint(OP_INTERNAL_TRANSFER, 32).storeUint(0, 64).storeCoins(MINT)
    .storeAddress(master).storeAddress(operator.address).storeCoins(0).storeBit(false)
    .endCell();
  const mintBody = beginCell().storeUint(OP_MINT, 32).storeUint(0, 64).storeAddress(operator.address).storeCoins(toNano("0.1")).storeRef(masterMsg).endCell();
  await operator.send({ to: master, value: toNano("0.5"), init: { code: minterCode, data: minterData }, body: mintBody });

  const operatorJW = jettonWalletOf(operator.address, master);
  assert.equal(await readJettonBalance(bc, operatorJW), MINT, "mint created the operator jetton wallet with balance");

  // ── OUR send_jetton: CAL → canonical_to_inner → TEP-74 body cell → op::transfer to operatorJW ──
  const SEND = 250n;
  const cal = {
    cal_version: "0.1.0", action: "wallet.send_jetton", agent_id: operator.address.toRawString(), nonce: 1n, expiration_tick: 10n ** 7n,
    preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [],
    steps: [{ verb: "wallet.send_jetton", params: { jetton_master: master.toRawString(), recipient: recipient.address.toRawString(), amount: SEND, query_id: 770003n }, post_conditions: [] }],
  };
  const body = canonicalToInner(cal).outActions[0]!.msg.body as unknown as JettonTransferBody;
  const transferCell = jettonBodyToCell(body); // OUR publication-layer serialization

  // the owner (operator) sends op::transfer + OUR body to its jetton wallet → it forwards to the recipient JW
  await operator.send({ to: operatorJW, value: toNano("0.2"), body: transferCell });

  const recipientJW = jettonWalletOf(recipient.address, master);
  assert.equal(await readJettonBalance(bc, recipientJW), SEND, "recipient jetton wallet received exactly the authorized amount");
  assert.equal(await readJettonBalance(bc, operatorJW), MINT - SEND, "operator jetton balance decreased by exactly the amount (⊆: no widening)");
});
