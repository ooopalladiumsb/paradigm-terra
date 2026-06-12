/**
 * PP#5-R1 plan artifact — deterministic reproducibility anchor for the send_nft live proof (PP#5-B).
 * Emits the pinned standard-NFT code hashes and a REFERENCE send_nft transfer body (fixed inputs) with its
 * cell hash + BoC, so PP#5-B can re-assert byte-identity of `nftBodyToCell` before the irreversible
 * broadcast (the real-recipient body is rebuilt at broadcast time; this pins the codec's determinism).
 * Offline, no network. Mirrors orchestrator/scripts/pp4-plan.ts. Run: `node --import tsx scripts/pp5-plan.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nftBodyToCell, NFT_TRANSFER_OP, type NftTransferBody } from "../src/ir-to-boc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const nc = JSON.parse(fs.readFileSync(path.join(here, "..", "contracts", "nft", "nft-compiled.json"), "utf8"));

// Reference inputs (deterministic; the live PP#5-B recipient differs — this pins codec determinism only).
const REF_NEW_OWNER = "0:" + "dd".repeat(32);
const REF_RESPONSE = "0:" + "bb".repeat(32);
const refBody: NftTransferBody = {
  kind: "nft_transfer", op: BigInt(NFT_TRANSFER_OP), query_id: 880005n,
  new_owner: REF_NEW_OWNER, response_destination: REF_RESPONSE,
  custom_payload: null, forward_amount: 0n, forward_payload: null,
};
const cell = nftBodyToCell(refBody);

const plan = {
  result: "PP#5-R1 OFFLINE (no broadcast)",
  framing: "the wallet.send_nft (TEP-62) publication path, proven against the official standard NFT in @ton/sandbox",
  network: "ton-testnet (live proof planned, GATED — PP#5-B)",
  nft_standard: nc.source,
  code_hashes: { collection: nc.collection.codeHash, item: nc.item.codeHash },
  reference_send_nft_body: {
    note: "fixed reference inputs — pins nftBodyToCell determinism; the live body uses the real PP#5-B recipient",
    op: "0x5fcc3d14",
    query_id: "880005",
    new_owner: REF_NEW_OWNER,
    response_destination: REF_RESPONSE,
    forward_amount: "0",
    cell_hash: "0x" + cell.hash().toString("hex"),
    boc_b64: cell.toBoc().toString("base64"),
  },
  sandbox_proof: {
    harness: "pp2/test/pp5-sandbox.test.ts",
    deploy_collection_mint_item_to_operator: true,
    our_send_nft_flips_owner: "operator -> recipient (get_nft_data.owner_address)",
    non_owner_rejected: "exit 401, ownership unchanged (authorization faithful)",
  },
  broadcast: "GATED — requires explicit go-ahead + funded testnet operator + key custody (PP#5-B)",
};

const outDir = path.join(here, "..", "artifacts", "pp5");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "pp5-plan.json"), JSON.stringify(plan, null, 2) + "\n");
console.log("wrote pp2/artifacts/pp5/pp5-plan.json");
console.log("reference body cell hash:", plan.reference_send_nft_body.cell_hash);
