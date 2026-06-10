#!/usr/bin/env node
// PP#3-A — infrastructure DRY run (no broadcast). Resolves every address offline (jetton master +
// operator/recipient jetton wallets, via the official standard derivation), runs OUR send_jetton path
// (canonical_to_inner → ir_to_boc) to show the TEP-74 body that will be published, and writes the deploy
// plan. PP#3-B (broadcast) follows only on explicit authorization. Mirrors the PP#2-B dry/broadcast split.
//   node scripts/pp3-plan.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cr from "@ton/crypto";
import { Address, beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { canonicalToInner } from "../../orchestrator/dist/w5/canonical-to-inner.js";
import { irToBoc } from "../src/ir-to-boc.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, "..", "artifacts", "pp3");
fs.mkdirSync(ART, { recursive: true });
const jc = JSON.parse(fs.readFileSync(path.join(HERE, "..", "contracts", "jetton", "jetton-compiled.json"), "utf8"));
const minterCode = Cell.fromBase64(jc.minter.codeBoc);
const walletCode = Cell.fromBase64(jc.wallet.codeBoc);

// operator = the PP#2 funded W5R1 wallet (the jetton admin + sender)
const seed = Buffer.from(fs.readFileSync(path.join(HERE, "..", ".secrets", "operator-seed.hex"), "utf8").trim(), "hex");
const kp = cr.keyPairFromSeed(seed);
const operator = WalletContractV5R1.create({ publicKey: kp.publicKey, walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } } }).address;
const recipient = Address.parseRaw("0:" + "d7".repeat(32)); // a deterministic test recipient owner

// ── official standard derivation (jetton-utils.fc), reproduced offline ──
const contentCell = beginCell().storeUint(0, 8).storeStringTail("PT-TEST-JETTON").endCell(); // minimal content
const minterData = beginCell().storeCoins(0).storeAddress(operator).storeRef(contentCell).storeRef(walletCode).endCell();
const master = contractAddress(0, { code: minterCode, data: minterData });
const packWalletData = (owner) => beginCell().storeCoins(0).storeAddress(owner).storeAddress(master).storeRef(walletCode).endCell();
const jettonWalletOf = (owner) => contractAddress(0, { code: walletCode, data: packWalletData(owner) });
const operatorJW = jettonWalletOf(operator);
const recipientJW = jettonWalletOf(recipient);

// ── OUR publication path for the send_jetton CAL (the subject of PP#3) ──
const MINT_AMOUNT = 1000n;
const SEND_AMOUNT = 250n;
const cal = {
  cal_version: "0.1.0", action: "wallet.send_jetton", agent_id: operator.toRawString(), nonce: 1n, expiration_tick: 10_000_000n,
  preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } }, invariants: [],
  steps: [{ verb: "wallet.send_jetton", params: { jetton_master: master.toRawString(), recipient: recipient.toRawString(), amount: SEND_AMOUNT, query_id: 770003n }, post_conditions: [] }],
};
const ir = canonicalToInner(cal);
const act = ir.outActions[0];
// resolve the agent jetton wallet (offline derivation; confirmed via get_wallet_address at broadcast)
const resolvedIr = { outActions: [{ ...act, msg: { ...act.msg, dest: operatorJW.toRawString() } }], extended: [] };
const innerBoc = irToBoc(resolvedIr);
const innerBodyHash = Cell.fromBoc(innerBoc)[0].hash().toString("hex");

const plan = {
  result: "PP#3-A DRY (no broadcast)",
  network: "ton-testnet (planned)",
  jetton: { source: jc.source, minterCodeHash: jc.minter.codeHash, walletCodeHash: jc.wallet.codeHash },
  addresses: {
    operator: operator.toString({ testOnly: true }), operator_raw: operator.toRawString(),
    jetton_master: master.toString({ testOnly: true }), jetton_master_raw: master.toRawString(),
    operator_jetton_wallet: operatorJW.toString({ testOnly: true }), operator_jetton_wallet_raw: operatorJW.toRawString(),
    recipient_owner_raw: recipient.toRawString(), recipient_jetton_wallet_raw: recipientJW.toRawString(),
  },
  send_jetton: {
    cal_action: cal.action, amount: SEND_AMOUNT.toString(), recipient: recipient.toRawString(), query_id: "770003",
    tep74_body: JSON.parse(JSON.stringify(act.msg.body, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    attached_ton_nano: act.msg.valueNano.toString(),
    inner_body_hash: innerBodyHash,
  },
  plan: [
    { step: "A deploy minter", to: "jetton_master (via stateInit)", value_ton: "0.2", note: "operator → master with {minterCode, minterData}" },
    { step: "B mint", to: "jetton_master", op: "0x15 (mint)", value_ton: "0.2", mint_amount: MINT_AMOUNT.toString(), note: "admin=operator mints to operator owner ⇒ operator jetton wallet created with balance" },
    { step: "C send_jetton", to: "operator_jetton_wallet", body: "TEP-74 transfer", value_ton: (Number(act.msg.valueNano) / 1e9).toFixed(3), note: "OUR codec/ir_to_boc external; moves SEND_AMOUNT jettons to recipient" },
    { step: "D observe", note: "recipient jetton wallet balance += SEND_AMOUNT; record in M2 registry (correlated)" },
  ],
  gas_estimate_ton: { deploy: "~0.1", mint: "~0.1", send_jetton: (Number(act.msg.valueNano) / 1e9).toFixed(3), total_budget: "~0.5" },
};
fs.writeFileSync(path.join(ART, "pp3-plan.json"), JSON.stringify(plan, null, 2) + "\n");

console.log("PP#3-A — DRY infrastructure plan (no broadcast)\n");
console.log("jetton master      ", plan.addresses.jetton_master);
console.log("operator jetton W   ", plan.addresses.operator_jetton_wallet);
console.log("recipient jetton W  ", plan.addresses.recipient_jetton_wallet_raw);
console.log("send_jetton amount  ", SEND_AMOUNT.toString(), "→", recipient.toRawString());
console.log("TEP-74 body op      ", "0x" + BigInt(act.msg.body.op).toString(16), "| inner body hash", innerBodyHash);
console.log("attached TON        ", (Number(act.msg.valueNano) / 1e9).toFixed(3), "TON");
console.log("\n→", path.join(ART, "pp3-plan.json"));
