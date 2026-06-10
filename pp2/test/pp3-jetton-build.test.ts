/**
 * PP#3-A — the official standard TEP-74 jetton (test infrastructure) compiles reproducibly. Recompiling
 * the vendored ton-blockchain/token-contract sources with the pinned func-js must reproduce the committed
 * minter/wallet code hashes. This pins the infrastructure PP#3 uses; it is NOT our code under test (PP#3
 * proves OUR publication path against this known-good jetton). Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compileFunc } from "@ton-community/func-js";
import { Cell } from "@ton/core";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "jetton");
const read = (f: string) => fs.readFileSync(path.join(SRC, f), "utf8");
const COMMON = ["stdlib.fc", "params.fc", "op-codes.fc", "jetton-utils.fc"];
const sources = Object.fromEntries([...COMMON, "jetton-minter.fc", "jetton-wallet.fc"].map((f) => [f, read(f)]));

async function codeHash(entry: string): Promise<string> {
  const res = await compileFunc({ targets: [...COMMON, entry], sources });
  if (res.status === "error") throw new Error(res.message);
  return Cell.fromBase64(res.codeBoc).hash().toString("hex");
}

test("PP#3-A: the vendored official jetton recompiles to the committed code hashes", async () => {
  const committed = JSON.parse(fs.readFileSync(path.join(SRC, "jetton-compiled.json"), "utf8"));
  assert.equal(await codeHash("jetton-minter.fc"), committed.minter.codeHash, "minter code hash drifted from the committed artifact");
  assert.equal(await codeHash("jetton-wallet.fc"), committed.wallet.codeHash, "wallet code hash drifted from the committed artifact");
});
