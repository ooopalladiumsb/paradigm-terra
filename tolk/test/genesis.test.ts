/**
 * L2.6 — Genesis package: drift guard + full-suite deploy. The committed reference manifest must be
 * re-derivable (addresses pinned), and the whole Layer-2 observational suite must deploy from genesis in
 * @ton/sandbox to an ALL-EMPTY initial state (Framing A — read-models, no consensus created). Offline.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";
import { genesisDeploy, genesisManifest, GENESIS_CONTRACTS } from "../src/genesis.ts";
import { REFERENCE_OWNER } from "../scripts/genesis.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "genesis", "genesis-manifest.json"), "utf8"));

test("L2.6: the genesis manifest is deterministic — re-derives the committed addresses + code hashes", () => {
  const fresh = genesisManifest(REFERENCE_OWNER);
  assert.equal(fresh.length, GENESIS_CONTRACTS.length, "all five contracts in the manifest");
  assert.deepEqual(fresh, committed.contracts, "manifest drifted (code or genesis-data changed)");
});

test("L2.6: the full observational suite deploys from genesis to an all-empty initial state (sandbox)", async () => {
  const bc = await Blockchain.create();
  const publisher = await bc.treasury("publisher");

  // deploy every contract from its genesis (code + genesis data), owner = the publisher
  const addrs: Record<string, import("@ton/core").Address> = {};
  for (const name of GENESIS_CONTRACTS) {
    const { code, data, address } = genesisDeploy(name, publisher.address);
    await publisher.send({ to: address, value: toNano("0.1"), init: { code, data }, body: undefined });
    addrs[name] = address;
  }

  // every contract is active and owned by the publisher
  for (const name of GENESIS_CONTRACTS) {
    const st = (await bc.getContract(addrs[name]!)).accountState;
    assert.equal(st?.type, "active", `${name} deployed active`);
    const owner = (await bc.runGetMethod(addrs[name]!, "owner", [])).stackReader.readAddress();
    assert.equal(owner.toString(), publisher.address.toString(), `${name} owner == publisher`);
  }

  // genesis state is empty/zero everywhere — nothing projected yet (read-models, no consensus created)
  const num = async (a: import("@ton/core").Address, m: string) => (await bc.runGetMethod(a, m, [])).stackReader.readBigNumber();
  assert.equal(await num(addrs["registry"]!, "agentCount"), 0n, "registry: 0 agents at genesis");
  assert.equal(await num(addrs["registry"]!, "mcpSchemaHash"), 0n, "registry: mcp hash unset at genesis");
  assert.equal(await num(addrs["treasury"]!, "nav"), 0n, "treasury: nav 0 at genesis");
  assert.equal(await num(addrs["failure-state"]!, "mode"), 0n, "failure-state: mode NORMAL (0) at genesis");
  assert.equal(await num(addrs["capability"]!, "agentCount"), 0n, "capability: 0 grants at genesis");
  assert.equal(await num(addrs["anchor-index"]!, "anchorCount"), 0n, "anchor-index: 0 anchors at genesis");
});

test("L2.6: genesis addresses are distinct (no two contracts collide)", () => {
  const addrs = committed.contracts.map((c: { address: string }) => c.address);
  assert.equal(new Set(addrs).size, addrs.length, "all five genesis addresses are distinct");
});
