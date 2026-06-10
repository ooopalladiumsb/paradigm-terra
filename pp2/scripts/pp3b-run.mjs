#!/usr/bin/env node
// PP#3-B — the live ton-testnet broadcast of J1-C (jetton publication path). Deploys the official jetton
// minter, mints to the operator, drives OUR send_jetton (canonical body → jettonBodyToCell → W5 external),
// observes the on-chain jetton effect, and records the settlement in the M2 reconciliation registry.
// IDEMPOTENT: each step checks chain state first, so an interrupted run resumes safely (pp3-b-gate.md §4).
//   node --import tsx scripts/pp3b-run.mjs              # DRY: plan + addresses, NO broadcast
//   BROADCAST=1 node --import tsx scripts/pp3b-run.mjs  # execute the irreversible testnet sequence
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyPairFromSeed } from "@ton/crypto";
import { WalletContractV5R1 } from "@ton/ton";
import { Address, beginCell, Cell, contractAddress, internal, storeMessage, toNano, SendMode } from "@ton/core";
import { jettonBodyToCell, JETTON_TRANSFER_OP } from "../src/ir-to-boc.js";

// M2 reconciliation record (mirrors m2-registry/src/record.ts) — built INLINE with pp2's own @ton/core
// so the Cell passes storeRef here (importing m2-registry's builder crosses a second @ton/core instance,
// whose Cell fails `instanceof Cell` → "Invalid argument").
const OP_UPSERT_RECORD = 0x52454301, STATUS_SETTLED = 1;
const buildRecordCell = (r) => beginCell().storeUint(r.status, 8).storeUint(r.nonce, 64).storeUint(r.calHash, 256).storeUint(r.txHash, 256).storeUint(r.observedEffectHash, 256).storeUint(r.updatedAt, 32).endCell();
const buildUpsertBody = (key, r) => beginCell().storeUint(OP_UPSERT_RECORD, 32).storeUint(key, 256).storeRef(buildRecordCell(r)).endCell();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const API = "https://testnet.toncenter.com/api/v2";
const KEY = process.env["TONCENTER_API_KEY"];
const BROADCAST = process.env["BROADCAST"] === "1";
const ART = path.join(ROOT, "artifacts", "pp3");
fs.mkdirSync(ART, { recursive: true });

const MINT = 1000n, SEND = 250n, QUERY_ID = 770003n;
const M2_REGISTRY = "0:36a31800352b72464ae093b4fd427732cdb75ec44c35ae24a9d9872335bf3a83"; // from M2-C
const OP_MINT = 21, OP_INTERNAL_TRANSFER = 0x178d4519;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function tc(method, init) {
  for (let a = 0; ; a++) {
    const dt = Date.now() - last; if (dt < 1300) await sleep(1300 - dt); last = Date.now();
    const sep = method.includes("?") ? "&" : "?";
    const j = await (await fetch(`${API}/${method}${KEY ? `${sep}api_key=${KEY}` : ""}`, init)).json();
    if (j && j.code === 429 && a < 8) { await sleep(2000 * (a + 1)); continue; }
    return j;
  }
}
const getState = async (raw) => (await tc(`getAddressInformation?address=${encodeURIComponent(raw)}`)).result?.state;
const liveSeqno = async (raw) => Number((await tc(`getWalletInformation?address=${encodeURIComponent(raw)}`)).result?.seqno ?? 0);
async function jettonBalance(raw) {
  if ((await getState(raw)) !== "active") return 0n;
  const r = await tc("runGetMethod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: raw, method: "get_wallet_data", stack: [] }) });
  if (r.result?.exit_code !== 0) return 0n;
  return BigInt(r.result.stack[0][1]); // balance is the first returned value
}

const kp = keyPairFromSeed(Buffer.from(fs.readFileSync(path.join(ROOT, ".secrets", "operator-seed.hex"), "utf8").trim(), "hex"));
const wallet = WalletContractV5R1.create({ publicKey: kp.publicKey, walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } } });
const operator = wallet.address;

const jc = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "jetton", "jetton-compiled.json"), "utf8"));
const minterCode = Cell.fromBase64(jc.minter.codeBoc), walletCode = Cell.fromBase64(jc.wallet.codeBoc);
const content = beginCell().storeUint(0, 8).storeStringTail("PT-TEST-JETTON").endCell();
const minterData = beginCell().storeCoins(0).storeAddress(operator).storeRef(content).storeRef(walletCode).endCell();
const master = contractAddress(0, { code: minterCode, data: minterData });
const recipient = Address.parseRaw("0:" + "d7".repeat(32));
const jettonWalletOf = (owner) => contractAddress(0, { code: walletCode, data: beginCell().storeCoins(0).storeAddress(owner).storeAddress(master).storeRef(walletCode).endCell() });
const operatorJW = jettonWalletOf(operator), recipientJW = jettonWalletOf(recipient);

// OUR send_jetton TEP-74 body (the publication path's output; codec→body verified in orchestrator tests)
const sendBody = jettonBodyToCell({ kind: "jetton_transfer", op: BigInt(JETTON_TRANSFER_OP), query_id: QUERY_ID, amount: SEND, destination: recipient.toRawString(), response_destination: operator.toRawString(), custom_payload: null, forward_ton_amount: 0n, forward_payload: null });

console.log(`PP#3-B ${BROADCAST ? "BROADCAST" : "DRY"} — jetton publication on ton-testnet`);
console.log(`operator        ${operator.toString({ testOnly: true })}`);
console.log(`jetton master   ${master.toString({ testOnly: true })}  (${master.toRawString()})`);
console.log(`operator JW     ${operatorJW.toString({ testOnly: true })}`);
console.log(`recipient JW    ${recipientJW.toRawString()}`);
console.log(`plan            deploy+mint ${MINT} → operator · send_jetton ${SEND} → recipient · M2 correlate`);

if (!BROADCAST) { console.log("\nDRY (no broadcast). Re-run with BROADCAST=1."); process.exit(0); }

// signed W5 external carrying `messages`; returns its hash and waits for the seqno to advance.
async function sendExternal(messages) {
  const seqno = await liveSeqno(operator.toRawString());
  const transfer = wallet.createTransfer({ seqno, secretKey: kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY, messages });
  const ext = beginCell().store(storeMessage({ info: { type: "external-in", dest: operator, importFee: 0n }, body: transfer })).endCell();
  const extHash = ext.hash().toString("hex");
  const resp = await tc("sendBoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boc: ext.toBoc().toString("base64") }) });
  if (!resp.ok) throw new Error(`sendBoc rejected: ${JSON.stringify(resp)}`);
  for (let i = 0; i < 40; i++) { await sleep(3000); if ((await liveSeqno(operator.toRawString())) > seqno) return extHash; }
  throw new Error(`seqno did not advance past ${seqno}`);
}
const waitUntil = async (fn, what) => { for (let i = 0; i < 40; i++) { await sleep(3000); if (await fn()) return; } throw new Error(`timeout waiting for ${what}`); };

// ── A+B: deploy minter + mint (idempotent: skip if operator JW already funded) ──
const balOpBefore0 = await jettonBalance(operatorJW.toRawString());
if (balOpBefore0 < SEND) {
  console.log("\n→ A+B deploy minter + mint");
  const masterMsg = beginCell().storeUint(OP_INTERNAL_TRANSFER, 32).storeUint(0, 64).storeCoins(MINT).storeAddress(master).storeAddress(operator).storeCoins(0).storeBit(false).endCell();
  const mintBody = beginCell().storeUint(OP_MINT, 32).storeUint(0, 64).storeAddress(operator).storeCoins(toNano("0.1")).storeRef(masterMsg).endCell();
  await sendExternal([internal({ to: master, value: toNano("0.5"), init: { code: minterCode, data: minterData }, body: mintBody, bounce: false })]);
  await waitUntil(async () => (await jettonBalance(operatorJW.toRawString())) >= MINT, "operator jetton balance");
  console.log("   minted:", (await jettonBalance(operatorJW.toRawString())).toString());
} else {
  console.log("\n→ A+B skipped (operator jetton wallet already funded)");
}

// ── balances before the proof transfer ──
const opBefore = await jettonBalance(operatorJW.toRawString());
const rcBefore = await jettonBalance(recipientJW.toRawString());

// ── C: OUR send_jetton (idempotent: skip if recipient already received) ──
// On a resume after C already broadcast, pass the known external hash so E can still correlate.
let sendExtHash = process.env["PP3_SEND_EXTHASH"] ?? null;
if (rcBefore < SEND) {
  console.log("→ C send_jetton (our publication path)");
  sendExtHash = await sendExternal([internal({ to: operatorJW, value: toNano("0.2"), body: sendBody, bounce: true })]);
  console.log("   external_message_hash:", sendExtHash);
  await waitUntil(async () => (await jettonBalance(recipientJW.toRawString())) >= rcBefore + SEND, "recipient jetton balance");
} else {
  console.log("→ C skipped (recipient already received)");
}

// ── D: observe effect + locate the proof tx ──
const opAfter = await jettonBalance(operatorJW.toRawString());
const rcAfter = await jettonBalance(recipientJW.toRawString());
const txs = await tc(`getTransactions?address=${encodeURIComponent(operatorJW.toRawString())}&limit=5`);
const sendTx = (txs.result ?? []).find((t) => (t.out_msgs ?? []).length > 0) ?? (txs.result ?? [])[0];
const txHash = sendTx ? Buffer.from(sendTx.transaction_id.hash, "base64").toString("hex") : null;
// end-state check (correct on a first run AND on a resume where C was skipped): the recipient holds
// exactly SEND and the operator holds MINT − SEND.
const settled = rcAfter === SEND && opAfter === MINT - SEND;
console.log(`→ D observe: operator ${opBefore}→${opAfter} | recipient ${rcBefore}→${rcAfter} | settled=${settled}`);

// capture the settlement evidence NOW (before the M2 step), so the proof is recorded regardless of E.
const writeEvidence = (correlated, recordKey) => {
  fs.writeFileSync(path.join(ART, "pp3b-evidence.json"), JSON.stringify({
    result: `PP#3-B ${settled ? "SETTLED" : "FAILED"}`, network: "ton-testnet",
    jetton_master: master.toRawString(), operator_jetton_wallet: operatorJW.toRawString(), recipient_jetton_wallet: recipientJW.toRawString(),
    send: { amount: SEND.toString(), recipient: recipient.toRawString(), query_id: QUERY_ID.toString(), external_message_hash: sendExtHash, tx_hash: txHash },
    balances: { operator_before: opBefore.toString(), operator_after: opAfter.toString(), recipient_before: rcBefore.toString(), recipient_after: rcAfter.toString() },
    m2: { registry: M2_REGISTRY, record_key: recordKey, correlated }, verdict: settled ? "SETTLED" : "FAILED",
  }, null, 2) + "\n");
};
writeEvidence(false, null);

// ── E: M2 reconciliation correlate (idempotent upsert keyed by the send external hash) ──
let registryRecordKey = null, correlated = false;
if (sendExtHash && (await getState(M2_REGISTRY)) === "active") {
  console.log("→ E M2 registry correlate");
  const key = BigInt("0x" + sendExtHash);
  const record = { status: STATUS_SETTLED, nonce: BigInt(await liveSeqno(operator.toRawString())), calHash: 0n, txHash: txHash ? BigInt("0x" + txHash) : 0n, observedEffectHash: 0n, updatedAt: Math.floor(Date.now() / 1000) };
  await sendExternal([internal({ to: Address.parseRaw(M2_REGISTRY), value: toNano("0.05"), body: buildUpsertBody(key, record), bounce: true })]);
  registryRecordKey = "0x" + sendExtHash;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const gr = await tc("runGetMethod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: M2_REGISTRY, method: "getRecord", stack: [["num", "0x" + key.toString(16)]] }) });
    if (gr.result?.exit_code === 0 && gr.result.stack?.[0]?.[0] === "cell") { correlated = true; break; }
  }
  console.log("   correlated:", correlated);
} else if (!sendExtHash) {
  console.log("→ E skipped (no send external hash — pass PP3_SEND_EXTHASH to correlate a prior send)");
}

writeEvidence(correlated, registryRecordKey);
const verdict = settled ? "SETTLED" : "FAILED";
console.log(`\n${settled ? "✅" : "⚠️"} PP#3-B ${verdict} (M2 correlated=${correlated}) — evidence → artifacts/pp3/pp3b-evidence.json`);
process.exit(settled ? 0 : 1);
