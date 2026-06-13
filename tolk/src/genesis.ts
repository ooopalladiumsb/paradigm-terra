// L2.6 — Genesis package: the deterministic deploy of the Layer-2 observational suite (the
// SIMULATION_PREVIEW Tick-0, but as READ-MODELS, not authoritative state — Framing A). Computes, for each
// of the five contracts, its initial c4 storage (genesis state: owner set, everything else zero/empty) and
// its deploy address from the golden code + that data. The manifest is deterministic in the publisher
// `owner`; pinning it (genesis-manifest.json) drift-guards the whole suite's deploy surface.
//
// This package DEPLOYS projections; it creates NO consensus (the off-chain fold stays authoritative).
import { Address, beginCell, Cell, contractAddress } from "@ton/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const codeOf = (name: string): Cell =>
  Cell.fromBase64(JSON.parse(readFileSync(join(ROOT, "build", `${name}.compiled.json`), "utf8")).codeBoc64);

/** The genesis (Tick-0) c4 storage for each contract: owner set, all projected state zero/empty. Each
 *  builder MUST match the contract's `struct Storage` layout exactly (the same bytes the deploy uses). */
export const GENESIS_DATA: Readonly<Record<string, (owner: Address) => Cell>> = {
  // registry: owner, mcpSchemaHash:uint256, agentCount:uint32, agents:dict
  registry: (o) => beginCell().storeAddress(o).storeUint(0n, 256).storeUint(0, 32).storeMaybeRef(null).endCell(),
  // treasury: owner, version:uint64, nav:uint256, developerFund:coins, collectedFees:coins
  treasury: (o) => beginCell().storeAddress(o).storeUint(0n, 64).storeUint(0n, 256).storeCoins(0n).storeCoins(0n).endCell(),
  // failure-state: owner, version:uint64, mode:uint8, isBoundedMode:bool, captureGuardHash:uint256
  "failure-state": (o) => beginCell().storeAddress(o).storeUint(0n, 64).storeUint(0, 8).storeBit(false).storeUint(0n, 256).endCell(),
  // capability: owner, agentCount:uint32, capabilities:dict
  capability: (o) => beginCell().storeAddress(o).storeUint(0, 32).storeMaybeRef(null).endCell(),
  // anchor-index: owner, latestVersion:uint64, anchorCount:uint32, anchors:dict
  "anchor-index": (o) => beginCell().storeAddress(o).storeUint(0n, 64).storeUint(0, 32).storeMaybeRef(null).endCell(),
};

/** The Layer-2 observational suite, in genesis deploy order. */
export const GENESIS_CONTRACTS = ["registry", "treasury", "failure-state", "capability", "anchor-index"] as const;

export interface GenesisEntry {
  readonly name: string;
  readonly codeHash: string;
  readonly address: string; // raw 0:<hex>, deterministic in (code, genesis data)
}

/** The full genesis manifest: each contract's pinned code hash + its deploy address for `owner`. */
export function genesisManifest(owner: Address): GenesisEntry[] {
  return GENESIS_CONTRACTS.map((name) => {
    const code = codeOf(name);
    const data = GENESIS_DATA[name]!(owner);
    return {
      name,
      codeHash: code.hash().toString("hex"),
      address: contractAddress(0, { code, data }).toRawString(),
    };
  });
}

/** The deploy inputs (code + genesis data) for one contract — used by the sandbox deploy + live genesis. */
export function genesisDeploy(name: string, owner: Address): { code: Cell; data: Cell; address: Address } {
  const code = codeOf(name);
  const data = GENESIS_DATA[name]!(owner);
  return { code, data, address: contractAddress(0, { code, data }) };
}
