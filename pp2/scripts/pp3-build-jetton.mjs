#!/usr/bin/env node
// PP#3-A — compile the OFFICIAL standard TEP-74 jetton (ton-blockchain/token-contract/ft) with func-js.
// This is test INFRASTRUCTURE for J1-C, not our code under test: PP#3 proves OUR publication path
// (canonical_to_inner → send_jetton codec → ir_to_boc → external → on-chain TEP-74 effect) against a
// known-good standard jetton wallet. Emits the minter/wallet code BoC + code hash. No network here.
//   node scripts/pp3-build-jetton.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunc } from "@ton-community/func-js";
import { Cell } from "@ton/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "contracts", "jetton");
const OUT = path.join(SRC, "jetton-compiled.json");

const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
// No #include in the sources — the official build compiles them as an ordered sequence.
const COMMON = ["stdlib.fc", "params.fc", "op-codes.fc", "jetton-utils.fc"];
const sources = Object.fromEntries(["stdlib.fc", "params.fc", "op-codes.fc", "jetton-utils.fc", "jetton-minter.fc", "jetton-wallet.fc"].map((f) => [f, read(f)]));

async function compile(entry) {
  const res = await compileFunc({ targets: [...COMMON, entry], sources });
  if (res.status === "error") throw new Error(`func-js failed for ${entry}:\n${res.message}`);
  const codeHash = Cell.fromBase64(res.codeBoc).hash().toString("hex");
  return { entry, codeBoc: res.codeBoc, codeHash };
}

const minter = await compile("jetton-minter.fc");
const wallet = await compile("jetton-wallet.fc");
const artifact = {
  source: "ton-blockchain/token-contract/main/ft (official standard TEP-74 jetton)",
  minter: { codeHash: minter.codeHash, codeBoc: minter.codeBoc },
  wallet: { codeHash: wallet.codeHash, codeBoc: wallet.codeBoc },
};
fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
console.log("✅ compiled official standard jetton (func-js)");
console.log("  minter codeHash:", minter.codeHash);
console.log("  wallet codeHash:", wallet.codeHash);
console.log("  →", OUT);
