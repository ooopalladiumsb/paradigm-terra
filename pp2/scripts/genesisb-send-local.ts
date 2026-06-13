// Genesis-B — LOCAL signer (run on YOUR machine; the mnemonic never leaves it). SIGN-AND-PRINT.
//
// Deploys the whole Layer-2 observational suite (5 contracts) in ONE W5 external message with 5 deploy
// out-actions (one seqno, one signature) — avoids the per-tx seqno races seen on PP#5-B. Reads the LIVE
// seqno, signs locally, prints the ready BoC; you paste it back and it gets relayed. Nothing is sent here.
//
// Self-contained in pp2's @ton/core (we read the golden code from tolk/build/ and rebuild the genesis c4
// data inline — importing tolk/src across packages mixes two @ton/core instances and breaks storeAddress).
//
// Run (in pp2/, with your testnet publisher's 24 words):
//   TON_MNEMONIC="word1 … word24" node --import tsx scripts/genesisb-send-local.ts
import { Address, beginCell, Cell, contractAddress, external, internal, SendMode, storeMessage, toNano } from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLISHER = Address.parse("0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j");
const TOLK_BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tolk", "build");
const codeOf = (name: string): Cell =>
  Cell.fromBase64(JSON.parse(fs.readFileSync(path.join(TOLK_BUILD, `${name}.compiled.json`), "utf8")).codeBoc64);

// Genesis c4 storage per contract — MUST match tolk/src/genesis.ts GENESIS_DATA exactly (rebuilt here
// with pp2's @ton/core so the Address instance matches storeAddress).
const GENESIS_DATA: Record<string, (o: Address) => Cell> = {
  registry: (o) => beginCell().storeAddress(o).storeUint(0n, 256).storeUint(0, 32).storeMaybeRef(null).endCell(),
  treasury: (o) => beginCell().storeAddress(o).storeUint(0n, 64).storeUint(0n, 256).storeCoins(0n).storeCoins(0n).endCell(),
  "failure-state": (o) => beginCell().storeAddress(o).storeUint(0n, 64).storeUint(0, 8).storeBit(false).storeUint(0n, 256).endCell(),
  capability: (o) => beginCell().storeAddress(o).storeUint(0, 32).storeMaybeRef(null).endCell(),
  "anchor-index": (o) => beginCell().storeAddress(o).storeUint(0n, 64).storeUint(0, 32).storeMaybeRef(null).endCell(),
};
const CONTRACTS = ["registry", "treasury", "failure-state", "capability", "anchor-index"] as const;
const deployOf = (name: string) => { const code = codeOf(name); const data = GENESIS_DATA[name]!(PUBLISHER); return { code, data, address: contractAddress(0, { code, data }) }; };

async function liveSeqno(addr: Address): Promise<number> {
  const r = await fetch("https://testnet.toncenter.com/api/v3/runGetMethod", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: addr.toRawString(), method: "seqno", stack: [] }),
  });
  return parseInt((await r.json()).stack[0].value, 16);
}

async function main(): Promise<void> {
  const words = (process.env.TON_MNEMONIC || "").trim().split(/\s+/);
  if (words.length !== 24) throw new Error("set TON_MNEMONIC to the publisher's 24 words");
  const key = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey, walletId: { networkGlobalId: -3 } } as Parameters<typeof WalletContractV5R1.create>[0]);
  if (!wallet.address.equals(PUBLISHER)) throw new Error(`derived ${wallet.address.toRawString()} != publisher ${PUBLISHER.toRawString()} — wrong mnemonic. ABORT.`);

  const seqno = await liveSeqno(PUBLISHER);
  const messages = CONTRACTS.map((name) => {
    const { code, data, address } = deployOf(name);
    return internal({ to: address, value: toNano("0.05"), bounce: false, init: { code, data }, body: beginCell().endCell() });
  });
  const body = wallet.createTransfer({
    seqno, secretKey: key.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY,
    timeout: Math.floor(Date.now() / 1000) + 3600, messages,
  } as Parameters<typeof wallet.createTransfer>[0]);
  const boc = beginCell().store(storeMessage(external({ to: wallet.address, body }))).endCell().toBoc().toString("base64");

  console.log("publisher :", PUBLISHER.toRawString(), "  live seqno:", seqno);
  CONTRACTS.forEach((n) => console.log("  deploy", n.padEnd(14), deployOf(n).address.toRawString()));
  console.log("\n===== COPY THIS BoC AND PASTE IT BACK (no mnemonic in it) =====\n");
  console.log(boc);
  console.log("\n===== END BoC =====");
}

main().catch((e) => { console.error("✗", e.message || e); process.exit(1); });
