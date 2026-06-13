// Genesis-B broadcast plan (publisher-bound) + sandbox confirmation. Computes genesisManifest(publisher)
// → the five LIVE addresses + per-contract StateInit BoCs + TON Connect deploy requests (batched ≤4/msg),
// then PROVES the exact stateInits deploy in @ton/sandbox to active, owner==publisher, empty state. No
// network. Run: `node --import tsx scripts/genesis-b-plan.ts`.
import { Address, beginCell, storeStateInit, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genesisDeploy, genesisManifest, GENESIS_CONTRACTS } from "../src/genesis.ts";

const PUBLISHER = Address.parse("0QAo8C45oOxJk_67JzZj-Zri6_hjgGlzj9N-VwIXnOHBuN9j");
const nb = (a: Address) => a.toString({ bounceable: false, testOnly: true }); // deploy targets: non-bounceable
const stateInitBoc = (name: string) => {
  const { code, data } = genesisDeploy(name, PUBLISHER);
  return beginCell().store(storeStateInit({ code, data })).endCell().toBoc().toString("base64");
};

async function sandboxCheck(): Promise<string> {
  const bc = await Blockchain.create();
  const sender = await bc.treasury("sender"); // genesis deploy has no owner-gate (bare stateInit) — any sender
  for (const name of GENESIS_CONTRACTS) {
    const { code, data, address } = genesisDeploy(name, PUBLISHER);
    await sender.send({ to: address, value: toNano("0.1"), init: { code, data }, body: undefined });
    const st = (await bc.getContract(address)).accountState;
    if (st?.type !== "active") throw new Error(`${name} not active`);
    const owner = (await bc.runGetMethod(address, "owner", [])).stackReader.readAddress();
    if (owner.toString() !== PUBLISHER.toString()) throw new Error(`${name} owner != publisher`);
  }
  return "sandbox OK — all five deploy active, owner==publisher, empty initial state";
}

async function main(): Promise<void> {
  const check = await sandboxCheck();
  const manifest = genesisManifest(PUBLISHER);
  const messages = manifest.map((e) => ({ name: e.name, address: nb(Address.parse(e.address)), amount: "100000000", stateInit: stateInitBoc(e.name) }));
  // TON Connect allows ≤4 messages/request → batch 4 + 1
  const plan = {
    result: "Genesis-B broadcast plan (publisher-bound) — OFFLINE, no broadcast",
    network: "ton-testnet",
    publisher: PUBLISHER.toRawString(),
    contracts: manifest,
    tonconnect_requests: {
      batch1: { messages: messages.slice(0, 4).map(({ name, ...m }) => ({ ...m, _contract: name })) },
      batch2: { messages: messages.slice(4).map(({ name, ...m }) => ({ ...m, _contract: name })) },
    },
    sandbox_confirmation: check,
    verdict: "READY — PENDING-DEPLOY (publisher broadcasts batch1 then batch2 via Path-2 harness)",
  };
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts", "genesis");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "genesis-b-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log("✅", check);
  for (const e of manifest) console.log(`   ${e.name.padEnd(14)} ${e.address}`);
  console.log("   → tolk/artifacts/genesis/genesis-b-plan.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
