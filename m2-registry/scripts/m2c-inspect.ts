// M2-C read-only diagnostic — derives the registry address exactly as m2c-testnet.ts does, then
// inspects on-chain state for both operator and registry (state, balance, recent txs + compute exit
// codes, bounces) and the registry getters. No broadcast, no secret signing — purely observational.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyPairFromSeed } from "@ton/crypto";
import { WalletContractV5R1 } from "@ton/ton";
import { Cell, contractAddress, type StateInit } from "@ton/core";
import { buildInitialStorage } from "../src/record.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const API = "https://testnet.toncenter.com/api/v2";
const KEY = process.env["TONCENTER_API_KEY"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function tc(method: string, init?: RequestInit): Promise<any> {
  const dt = Date.now() - last;
  if (dt < 1300) await sleep(1300 - dt);
  last = Date.now();
  const sep = method.includes("?") ? "&" : "?";
  const url = `${API}/${method}${KEY ? `${sep}api_key=${KEY}` : ""}`;
  return (await (await fetch(url, init)).json()) as any;
}

const seed = Buffer.from(fs.readFileSync(path.join(ROOT, "..", "pp2", ".secrets", "operator-seed.hex"), "utf8").trim(), "hex");
const kp = keyPairFromSeed(seed);
const wallet = WalletContractV5R1.create({
  publicKey: kp.publicKey,
  walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } },
});
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "registry.compiled.json"), "utf8"));
const init: StateInit = { code: Cell.fromBase64(artifact.codeBoc64), data: buildInitialStorage(wallet.address) };
const registry = contractAddress(0, init);

console.log("operator", wallet.address.toString({ testOnly: true }), "\n  raw", wallet.address.toRawString());
console.log("registry", registry.toString({ testOnly: true }), "\n  raw", registry.toRawString());

for (const [label, raw] of [
  ["operator", wallet.address.toRawString()],
  ["registry", registry.toRawString()],
] as const) {
  const info = await tc(`getAddressInformation?address=${encodeURIComponent(raw)}`);
  console.log(`\n[${label}] state=${info.result?.state} balance=${info.result?.balance}`);
  const txs = await tc(`getTransactions?address=${encodeURIComponent(raw)}&limit=4`);
  for (const t of txs.result ?? []) {
    const inm = t.in_msg ?? {};
    console.log(
      `  tx utime=${t.utime} from=${inm.source || "(ext)"} value=${inm.value ?? "-"} out=${(t.out_msgs ?? []).length}` +
        ` exit=${t.description?.compute_ph?.exit_code ?? "?"} bounced=${(t.out_msgs ?? []).some((m: any) => m.bounced)}`,
    );
  }
}

const rc = await tc("runGetMethod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: registry.toRawString(), method: "recordCount", stack: [] }) });
console.log(`\nrecordCount: exit_code=${rc.result?.exit_code} stack=${JSON.stringify(rc.result?.stack)}`);
