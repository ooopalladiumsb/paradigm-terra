// PP#5-B step 2 — LOCAL signer (run on YOUR machine; the mnemonic never leaves it).
//
// SIGN-AND-PRINT mode: the TON Connect path + TonClient broadcast both proved unreliable here (stale
// seqno cache / POST endpoint). This signs the send_nft transfer LOCALLY with the operator's key at the
// CORRECT live seqno and PRINTS the ready external-message BoC. You paste that BoC back; it gets relayed
// to the network from a working endpoint. Nothing is sent from this script. Tier-M, publication layer.
//
// Run (in pp2/, with your testnet operator's 24 words):
//   TON_MNEMONIC="word1 … word24" node --import tsx scripts/pp5b-send-local.ts
import { Address, beginCell, external, internal, SendMode, storeMessage, toNano } from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { itemAddress, sendNftBody } from "../src/nft-deploy.ts";

const OPERATOR = Address.parse("0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j");
const RECIPIENT = Address.parse("0QD6xP-v3wm4O6uV-PxXl6vVFFvEMg4C7kHiLFrV-3PyaF4Q");
const QUERY_ID = 880013n;

async function liveSeqno(addr: Address): Promise<number> {
  const r = await fetch("https://testnet.toncenter.com/api/v3/runGetMethod", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: addr.toRawString(), method: "seqno", stack: [] }),
  });
  const d = await r.json();
  return parseInt(d.stack[0].value, 16);
}

async function main(): Promise<void> {
  const words = (process.env.TON_MNEMONIC || "").trim().split(/\s+/);
  if (words.length !== 24) throw new Error("set TON_MNEMONIC to the operator's 24 words");
  const key = await mnemonicToPrivateKey(words);

  // testnet W5R1 (networkGlobalId -3 — confirmed to derive the operator address).
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey, walletId: { networkGlobalId: -3 } } as Parameters<typeof WalletContractV5R1.create>[0]);
  if (!wallet.address.equals(OPERATOR)) {
    throw new Error(`derived ${wallet.address.toRawString()} != operator ${OPERATOR.toRawString()} — wrong mnemonic. ABORT.`);
  }

  const seqno = await liveSeqno(OPERATOR);
  const item = itemAddress(OPERATOR);
  const body = wallet.createTransfer({
    seqno,
    secretKey: key.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    timeout: Math.floor(Date.now() / 1000) + 3600, // 1-hour validity — leaves time to copy/paste/relay
    messages: [internal({ to: item, value: toNano("0.1"), bounce: true, body: sendNftBody(RECIPIENT, OPERATOR, QUERY_ID) })],
  } as Parameters<typeof wallet.createTransfer>[0]);
  const ext = beginCell().store(storeMessage(external({ to: wallet.address, body }))).endCell();
  const boc = ext.toBoc().toString("base64");

  console.log("operator :", OPERATOR.toRawString());
  console.log("item #0  :", item.toRawString());
  console.log("live seqno:", seqno, "(signed at this seqno)");
  console.log("\n===== COPY THIS BoC AND PASTE IT BACK (no mnemonic in it) =====\n");
  console.log(boc);
  console.log("\n===== END BoC =====");
}

main().catch((e) => { console.error("✗", e.message || e); process.exit(1); });
