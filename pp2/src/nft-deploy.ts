// PP#5-B — deterministic builders for the live send_nft proof: the standard TEP-62 collection deploy +
// mint (item #0 to the operator) + our send_nft, all derived from the vendored golden code + the operator
// / recipient addresses. Used by the broadcast-plan builder AND the sandbox confirmation, so the bytes the
// harness broadcasts are the bytes the sandbox proved. Tier-M, no Freeze Surface.
import { Address, beginCell, Cell, contractAddress, storeStateInit, toNano } from "@ton/core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nftBodyToCell, NFT_TRANSFER_OP, type NftTransferBody } from "./ir-to-boc.js";

const NC = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "nft", "nft-compiled.json"), "utf8"));
export const collectionCode = Cell.fromBase64(NC.collection.codeBoc);
export const itemCode = Cell.fromBase64(NC.item.codeBoc);

/** Collection c4 data (owner-bound). Mirrors the R1 sandbox proof exactly. */
export function collectionData(owner: Address): Cell {
  const content = beginCell()
    .storeRef(beginCell().storeUint(0, 8).storeStringTail("PT-TEST-NFT").endCell())
    .storeRef(beginCell().storeStringTail("pt-test/").endCell())
    .endCell();
  const royalty = beginCell().storeUint(0, 16).storeUint(100, 16).storeAddress(owner).endCell();
  return beginCell().storeAddress(owner).storeUint(0, 64).storeRef(content).storeRef(itemCode).storeRef(royalty).endCell();
}
export const collectionAddress = (owner: Address): Address => contractAddress(0, { code: collectionCode, data: collectionData(owner) });
export const collectionStateInitBoc = (owner: Address): string =>
  beginCell().store(storeStateInit({ code: collectionCode, data: collectionData(owner) })).endCell().toBoc().toString("base64");

/** Item #0 c4 data + address (the standard derivation: index(64) + collection address). */
export const itemData = (owner: Address): Cell => beginCell().storeUint(0, 64).storeAddress(collectionAddress(owner)).endCell();
export const itemAddress = (owner: Address): Address => contractAddress(0, { code: itemCode, data: itemData(owner) });

/** Collection op=1 (deploy new nft): mint item #0 to `owner`. Body = op|query_id|index|coins|^nftContent. */
export function mintBody(owner: Address): Cell {
  const nftContent = beginCell().storeAddress(owner).storeRef(beginCell().storeStringTail("item-0").endCell()).endCell();
  return beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(0, 64).storeCoins(toNano("0.05")).storeRef(nftContent).endCell();
}

/** OUR send_nft TEP-62 body (recipient = new owner; response = operator). */
export function sendNftBody(recipient: Address, operator: Address, queryId: bigint): Cell {
  const body: NftTransferBody = {
    kind: "nft_transfer", op: BigInt(NFT_TRANSFER_OP), query_id: queryId,
    new_owner: recipient.toRawString(), response_destination: operator.toRawString(),
    custom_payload: null, forward_amount: 0n, forward_payload: null,
  };
  return nftBodyToCell(body);
}
