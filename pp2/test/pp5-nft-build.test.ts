/**
 * PP#5-A — the official standard TEP-62 NFT (test infrastructure) compiles reproducibly. Recompiling the
 * vendored ton-blockchain/token-contract (nft) sources with the pinned func-js must reproduce the committed
 * collection/item code hashes. This pins the infrastructure PP#5 uses; it is NOT our code under test (PP#5
 * proves OUR send_nft body against this known-good NFT). Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compileFunc } from "@ton-community/func-js";
import { Cell } from "@ton/core";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "nft");
const read = (f: string) => fs.readFileSync(path.join(SRC, f), "utf8");
const COMMON = ["stdlib.fc", "op-codes.fc", "params.fc"];
const sources = Object.fromEntries([...COMMON, "nft-collection.fc", "nft-item.fc"].map((f) => [f, read(f)]));

async function codeHash(entry: string): Promise<string> {
  const res = await compileFunc({ targets: [...COMMON, entry], sources });
  if (res.status === "error") throw new Error(res.message);
  return Cell.fromBase64(res.codeBoc).hash().toString("hex");
}

test("PP#5-A: the vendored official TEP-62 NFT recompiles to the committed code hashes", async () => {
  const committed = JSON.parse(fs.readFileSync(path.join(SRC, "nft-compiled.json"), "utf8"));
  assert.equal(await codeHash("nft-collection.fc"), committed.collection.codeHash, "collection code hash drifted from the committed artifact");
  assert.equal(await codeHash("nft-item.fc"), committed.item.codeHash, "item code hash drifted from the committed artifact");
});
