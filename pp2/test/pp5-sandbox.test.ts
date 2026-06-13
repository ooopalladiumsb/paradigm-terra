/**
 * PP#5-A.2 — offline TVM validation (no network). Runs the send_nft publication path against the REAL
 * official standard TEP-62 NFT, executed in @ton/sandbox: deploy collection → mint item #0 to operator →
 * send OUR send_nft TEP-62 body (produced by canonical_to_inner → nftBodyToCell) to the item → the item's
 * owner flips operator → recipient. This validates message construction + the ⊆ rule (faithful new owner,
 * no second item moves) against the known-good contract BEFORE any irreversible testnet broadcast (PP#5-B).
 * Offline. Unlike jetton, an NFT settles by OWNERSHIP, not balance — the observable is the owner field.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Address, beginCell, Cell, contractAddress, toNano, type TupleItem } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { nftBodyToCell, NFT_TRANSFER_OP, type NftTransferBody } from "../src/ir-to-boc.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "nft");
const nc = JSON.parse(fs.readFileSync(path.join(SRC, "nft-compiled.json"), "utf8"));
const collectionCode = Cell.fromBase64(nc.collection.codeBoc);
const itemCode = Cell.fromBase64(nc.item.codeBoc);

// get_nft_data → (init?, index, collection_address, owner_address, content); we read the owner (4th).
async function readNftOwner(bc: Blockchain, item: Address): Promise<string> {
  const st = (await bc.getContract(item)).accountState;
  if (!st || st.type !== "active") throw new Error("nft item not active");
  const r = await bc.runGetMethod(item, "get_nft_data", []);
  r.stackReader.readBigNumber(); // init?
  r.stackReader.readBigNumber(); // index
  r.stackReader.readAddress(); // collection_address
  return r.stackReader.readAddress().toString(); // owner_address
}

test("PP#5-A.2: our send_nft body flips NFT ownership through the real standard item (sandbox)", async () => {
  const bc = await Blockchain.create();
  const operator = await bc.treasury("operator");
  const recipient = await bc.treasury("recipient");

  // collection data: owner = operator, next_item_index = 0, content, item code, royalty params
  const collectionContent = beginCell().storeUint(0, 8).storeStringTail("PT-TEST-NFT").endCell();
  const commonContent = beginCell().storeStringTail("pt-test/").endCell();
  const content = beginCell().storeRef(collectionContent).storeRef(commonContent).endCell();
  const royalty = beginCell().storeUint(0, 16).storeUint(100, 16).storeAddress(operator.address).endCell();
  const collectionData = beginCell()
    .storeAddress(operator.address)
    .storeUint(0, 64)
    .storeRef(content)
    .storeRef(itemCode)
    .storeRef(royalty)
    .endCell();
  const collection = contractAddress(0, { code: collectionCode, data: collectionData });

  // ── deploy collection + mint item #0 to operator (one owner message: op=1 deploy) ──
  // the forwarded nft_content the item reads on init = owner_address + content ref
  const nftContent = beginCell().storeAddress(operator.address).storeRef(beginCell().storeStringTail("item-0").endCell()).endCell();
  const mintBody = beginCell()
    .storeUint(1, 32).storeUint(0, 64) // op 1 (deploy new nft), query_id
    .storeUint(0, 64) // item_index = 0
    .storeCoins(toNano("0.05")) // TON forwarded to the new item
    .storeRef(nftContent)
    .endCell();
  await operator.send({ to: collection, value: toNano("0.5"), init: { code: collectionCode, data: collectionData }, body: mintBody });

  // resolve item #0 via the collection getter and confirm it minted owned by the operator
  const idx: TupleItem[] = [{ type: "int", value: 0n }];
  const item = (await bc.runGetMethod(collection, "get_nft_address_by_index", idx)).stackReader.readAddress();
  assert.equal(await readNftOwner(bc, item), operator.address.toString(), "mint created item #0 owned by the operator");

  // ── OUR send_nft TEP-62 body → op::transfer to the item ──
  // This NftTransferBody is EXACTLY what canonical_to_inner emits for `wallet.send_nft`
  // {nft_item, new_owner, query_id} with the defaults (response_destination ⇒ agent, forward ⇒ 0,
  // payload ⇒ absent); that codec→body step is verified in orchestrator/test/send-nft-codec.test.ts.
  // Reconstructed here so pp2's CI job stays independent of the orchestrator build. The cell is OUR
  // publication-layer serialization (nftBodyToCell).
  const body: NftTransferBody = {
    kind: "nft_transfer", op: BigInt(NFT_TRANSFER_OP), query_id: 880005n,
    new_owner: recipient.address.toRawString(), response_destination: operator.address.toRawString(),
    custom_payload: null, forward_amount: 0n, forward_payload: null,
  };
  const transferCell = nftBodyToCell(body);

  // the owner (operator) sends op::transfer + OUR body to the item → it rewrites owner → recipient
  await operator.send({ to: item, value: toNano("0.1"), body: transferCell });

  assert.equal(await readNftOwner(bc, item), recipient.address.toString(), "send_nft flipped ownership operator → recipient (⊆: faithful new owner, no redirection)");
});

test("PP#5-A.2 ⊆: a sub-threshold actor cannot move the item — only the current owner's transfer settles", async () => {
  const bc = await Blockchain.create();
  const operator = await bc.treasury("operator");
  const recipient = await bc.treasury("recipient");
  const stranger = await bc.treasury("stranger");

  const content = beginCell().storeRef(beginCell().storeUint(0, 8).storeStringTail("PT-TEST-NFT").endCell()).storeRef(beginCell().storeStringTail("pt-test/").endCell()).endCell();
  const royalty = beginCell().storeUint(0, 16).storeUint(100, 16).storeAddress(operator.address).endCell();
  const collectionData = beginCell().storeAddress(operator.address).storeUint(0, 64).storeRef(content).storeRef(itemCode).storeRef(royalty).endCell();
  const collection = contractAddress(0, { code: collectionCode, data: collectionData });
  const nftContent = beginCell().storeAddress(operator.address).storeRef(beginCell().storeStringTail("item-0").endCell()).endCell();
  const mintBody = beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(0, 64).storeCoins(toNano("0.05")).storeRef(nftContent).endCell();
  await operator.send({ to: collection, value: toNano("0.5"), init: { code: collectionCode, data: collectionData }, body: mintBody });
  const item = (await bc.runGetMethod(collection, "get_nft_address_by_index", [{ type: "int", value: 0n }])).stackReader.readAddress();

  // a stranger (not the owner) attempts the exact same transfer body — the item rejects (throw 401), owner unchanged
  const body: NftTransferBody = { kind: "nft_transfer", op: BigInt(NFT_TRANSFER_OP), query_id: 1n, new_owner: stranger.address.toRawString(), response_destination: stranger.address.toRawString(), custom_payload: null, forward_amount: 0n, forward_payload: null };
  const res = await stranger.send({ to: item, value: toNano("0.1"), body: nftBodyToCell(body) });
  assert.ok(res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 401), "non-owner transfer aborts with exit 401");
  assert.equal(await readNftOwner(bc, item), operator.address.toString(), "ownership unchanged after a non-owner attempt");
  void recipient;
});
