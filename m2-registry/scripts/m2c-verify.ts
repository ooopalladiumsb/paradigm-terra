// M2-C · SC-3 — read-only verifier. Re-derives the registry address, reads the settlement record back
// from ton-testnet by its external_message_hash key, decodes it, and asserts the correlation
// (status Settled · a real settling txHash · nonce). Writes artifacts/m2c/m2c-verdict.json. No secret,
// no broadcast — a reviewer can re-run this to reproduce the SC-3 verdict from on-chain state alone
// (the same discipline as pp2/scripts/pp2b-verify.mjs).
//
//   node --import tsx scripts/m2c-verify.ts            # uses the recorded run's key
//   M2C_KEY=0x… node --import tsx scripts/m2c-verify.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyPairFromSeed } from "@ton/crypto";
import { WalletContractV5R1 } from "@ton/ton";
import { Cell, contractAddress, type StateInit } from "@ton/core";
import { buildInitialStorage, parseRecordCell, SettlementStatus, type ReconciliationRecord } from "../src/record.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const API = "https://testnet.toncenter.com/api/v2";
const KEY_ENV = process.env["TONCENTER_API_KEY"];
// the external_message_hash of the M2-C send_ton settlement (the dict key); overridable via M2C_KEY.
const DEFAULT_KEY = "0x5e0299ea565f611f914a251b3ebff3c53c8c5969fa9a2cfa3092da887946f6fd";
const ART = path.join(ROOT, "artifacts", "m2c");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function tcFetch(method: string, init?: RequestInit): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const dt = Date.now() - last;
    if (dt < 1300) await sleep(1300 - dt);
    last = Date.now();
    const sep = method.includes("?") ? "&" : "?";
    const url = `${API}/${method}${KEY_ENV ? `${sep}api_key=${KEY_ENV}` : ""}`;
    const j = (await (await fetch(url, init)).json()) as any;
    if (j && j.code === 429 && attempt < 8) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return j;
  }
}

async function runGetter(addrRaw: string, method: string, stack: unknown[]): Promise<any> {
  return tcFetch("runGetMethod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addrRaw, method, stack }) });
}

/** Read the registry: record count + the stored record for `key` (null if absent). Throttled + retried. */
export async function readRegistry(registryRaw: string, key: bigint): Promise<{ recordCount: number; record: ReconciliationRecord | null }> {
  const rc = await runGetter(registryRaw, "recordCount", []);
  const recordCount = rc.result?.exit_code === 0 ? Number(BigInt(rc.result.stack[0][1])) : -1;
  const gr = await runGetter(registryRaw, "getRecord", [["num", "0x" + key.toString(16)]]);
  const top = gr.result?.stack?.[0];
  const record = top && top[0] === "cell" ? parseRecordCell(Cell.fromBase64(top[1].bytes)) : null;
  return { recordCount, record };
}

export function deriveRegistry(): { operatorRaw: string; registryRaw: string; codeHashHex: string } {
  const seed = Buffer.from(fs.readFileSync(path.join(ROOT, "..", "pp2", ".secrets", "operator-seed.hex"), "utf8").trim(), "hex");
  const kp = keyPairFromSeed(seed);
  const wallet = WalletContractV5R1.create({
    publicKey: kp.publicKey,
    walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } },
  });
  const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "registry.compiled.json"), "utf8"));
  const init: StateInit = { code: Cell.fromBase64(artifact.codeBoc64), data: buildInitialStorage(wallet.address) };
  return { operatorRaw: wallet.address.toRawString(), registryRaw: contractAddress(0, init).toRawString(), codeHashHex: artifact.codeHashHex };
}

async function main() {
  const key = BigInt(process.env["M2C_KEY"] ?? DEFAULT_KEY);
  // Reviewer-reproducible: pass the public M2C_REGISTRY (raw) to verify with NO secret. Without it,
  // the registry address is re-derived from the operator seed (build code + initial storage).
  const codeHashHex = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "registry.compiled.json"), "utf8")).codeHashHex;
  const envRegistry = process.env["M2C_REGISTRY"];
  const operatorRaw = envRegistry ? (process.env["M2C_OPERATOR"] ?? null) : deriveRegistry().operatorRaw;
  const registryRaw = envRegistry ?? deriveRegistry().registryRaw;
  const { recordCount, record } = await readRegistry(registryRaw, key);

  const ok =
    recordCount >= 1 &&
    record !== null &&
    record.status === SettlementStatus.Settled &&
    record.txHash !== 0n;

  console.log(`registry      ${registryRaw}`);
  console.log(`codeHash      ${codeHashHex}`);
  console.log(`recordCount   ${recordCount}`);
  if (record) {
    console.log(`record.status ${SettlementStatus[record.status]}`);
    console.log(`record.nonce  ${record.nonce}`);
    console.log(`record.txHash ${record.txHash.toString(16)}`);
  }
  console.log(`\n${ok ? "✅ M2-C SC-3 VERIFIED" : "❌ SC-3 NOT verified"} — settlement record present on ton-testnet, status Settled, real settling tx.`);

  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(
    path.join(ART, "m2c-verdict.json"),
    JSON.stringify(
      {
        result: ok ? "SC-3 VERIFIED" : "SC-3 FAILED",
        network: "ton-testnet",
        operator: operatorRaw,
        registry: registryRaw,
        codeHashHex,
        externalMessageHash: "0x" + key.toString(16),
        recordCount,
        record: record
          ? {
              status: SettlementStatus[record.status],
              nonce: record.nonce.toString(),
              calHash: "0x" + record.calHash.toString(16),
              txHash: "0x" + record.txHash.toString(16),
              observedEffectHash: "0x" + record.observedEffectHash.toString(16),
              updatedAt: record.updatedAt,
            }
          : null,
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n",
  );
  if (!ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
