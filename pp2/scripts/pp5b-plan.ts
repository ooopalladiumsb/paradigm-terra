// PP#5-B broadcast plan (operator-bound) + sandbox confirmation. Computes, for the REAL operator/recipient,
// the collection/item addresses, the deploy+mint and send_nft TON Connect requests, and pins the send_nft
// body hash — then PROVES the exact builders end-to-end in @ton/sandbox (a stand-in operator, since the
// owner must equal the sender). No network. Run: `node --import tsx scripts/pp5b-plan.ts`.
import { Address, beginCell, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectionAddress, collectionStateInitBoc, itemAddress, itemData, mintBody, sendNftBody, collectionCode, itemCode } from "../src/nft-deploy.ts";

const OPERATOR = Address.parse("0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j");
const RECIPIENT = Address.parse("0QD6xP-v3wm4O6uV-PxXl6vVFFvEMg4C7kHiLFrV-3PyaF4Q");
const QUERY_ID = 880013n;
const nb = (a: Address) => a.toString({ bounceable: false, testOnly: true }); // deploy targets: non-bounceable
const b = (a: Address) => a.toString({ bounceable: true, testOnly: true });

// ── sandbox confirmation: the exact builders flip ownership (stand-in operator == sender == owner) ──
async function sandboxCheck(): Promise<string> {
  const bc = await Blockchain.create();
  const op = await bc.treasury("op");
  const rcpt = await bc.treasury("rcpt");
  const coll = collectionAddress(op.address);
  await op.send({ to: coll, value: toNano("0.5"), init: { code: collectionCode, data: (await import("../src/nft-deploy.ts")).collectionData(op.address) }, body: mintBody(op.address) });
  const item = itemAddress(op.address);
  // item address must match the collection's own derivation
  const viaGetter = (await bc.runGetMethod(coll, "get_nft_address_by_index", [{ type: "int", value: 0n }])).stackReader.readAddress();
  if (!item.equals(viaGetter)) throw new Error(`item address mismatch: ${item} != ${viaGetter}`);
  const ownerBefore = (async () => { const r = await bc.runGetMethod(item, "get_nft_data", []); r.stackReader.readBigNumber(); r.stackReader.readBigNumber(); r.stackReader.readAddress(); return r.stackReader.readAddress(); });
  if ((await ownerBefore()).toString() !== op.address.toString()) throw new Error("mint did not set operator as owner");
  await op.send({ to: item, value: toNano("0.1"), body: sendNftBody(rcpt.address, op.address, QUERY_ID) });
  const after = await ownerBefore();
  if (after.toString() !== rcpt.address.toString()) throw new Error(`owner did not flip: ${after}`);
  return "sandbox OK — deploy+mint+send_nft flips owner operator→recipient with these exact builders";
}

async function main(): Promise<void> {
  const check = await sandboxCheck();
  const coll = collectionAddress(OPERATOR);
  const item = itemAddress(OPERATOR);
  const sendBody = sendNftBody(RECIPIENT, OPERATOR, QUERY_ID);
  const plan = {
    result: "PP#5-B broadcast plan (operator-bound) — OFFLINE, no broadcast",
    network: "ton-testnet",
    operator: OPERATOR.toRawString(),
    recipient: RECIPIENT.toRawString(),
    query_id: QUERY_ID.toString(),
    derived: {
      collection_address: coll.toRawString(),
      item0_address: item.toRawString(),
      send_nft_body_hash: "0x" + sendBody.hash().toString("hex"),
    },
    tonconnect_requests: {
      step1_deploy_collection_and_mint: { messages: [{ address: nb(coll), amount: "500000000", stateInit: collectionStateInitBoc(OPERATOR), payload: mintBody(OPERATOR).toBoc().toString("base64") }] },
      step2_send_nft: { messages: [{ address: b(item), amount: "100000000", payload: sendBody.toBoc().toString("base64") }] },
    },
    sandbox_confirmation: check,
    item_data_note: "item0 = contractAddress({itemCode, index0 + collection}) — matches collection get_nft_address_by_index(0)",
    void_itemData: itemData(OPERATOR).hash().toString("hex"),
    void_codes: { collection: collectionCode.hash().toString("hex"), item: itemCode.hash().toString("hex") },
    verdict: "READY — PENDING-DEPLOY (operator broadcasts step1 then step2 via Path-2 harness)",
  };
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts", "pp5");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "pp5b-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log("✅", check);
  console.log("   collection:", coll.toRawString());
  console.log("   item #0   :", item.toRawString());
  console.log("   send_nft body hash:", plan.derived.send_nft_body_hash);
  console.log("   → pp2/artifacts/pp5/pp5b-plan.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
