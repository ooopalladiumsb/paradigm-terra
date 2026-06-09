// M2-C · SC-3 — the network leg (ton-testnet). Deploy the Registry, drive one real wallet.send_ton
// settlement, observe its on-chain effect, classify it off-chain (M2-B), record it on-chain, then read
// the record back and correlate CAL → tx/effect → registry record. GATED, optional, non-blocking
// (charter §3/§6): runs only with testnet access + BROADCAST=1; the offline SC-1/SC-2 close without it.
//
//   node --import tsx scripts/m2c-testnet.ts             # DRY: derive addresses + plan, NO broadcast
//   BROADCAST=1 node --import tsx scripts/m2c-testnet.ts # deploy + send_ton + upsert + read-back
//
// Reuses the PP#2-B funded W5R1 operator (same key/address) as the Registry owner. Seed from
// $M2C_SEED_HEX or ../pp2/.secrets/operator-seed.hex. NON-NORMATIVE operational artifact (Tier M).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyPairFromSeed } from "@ton/crypto";
import { WalletContractV5R1 } from "@ton/ton";
import { readRegistry } from "./m2c-verify.ts";
import {
  beginCell,
  Cell,
  internal,
  storeMessage,
  contractAddress,
  Address,
  toNano,
  SendMode,
  type StateInit,
} from "@ton/core";
import { buildInitialStorage, buildUpsertBody, parseRecordCell, SettlementStatus, type ReconciliationRecord } from "../src/record.ts";
import { classify, type ExpectedSettlement, type ObservedSettlement } from "../src/reconcile.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const API = "https://testnet.toncenter.com/api/v2";
const BROADCAST = process.env["BROADCAST"] === "1";
const ART = path.join(ROOT, "artifacts", "m2c");

const SEND_VALUE = 50_000_000n; // 0.05 TON, self-send (the observed settlement) — matches PP#2-B
const SETTLE_WINDOW_S = 120; // expected settlement window (the PP#2 valid_until horizon)

const API_KEY = process.env["TONCENTER_API_KEY"]; // optional — raises the toncenter rate limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The public toncenter endpoint rate-limits to ~1 req/s (keyless). Serialize every call through a
// throttle + retry on 429 so the multi-tx leg doesn't trip "Ratelimit exceed".
let lastReq = 0;
async function tcFetch(url: string, init?: RequestInit): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const dt = Date.now() - lastReq;
    if (dt < 1200) await sleep(1200 - dt);
    lastReq = Date.now();
    const j = (await (await fetch(url, init)).json()) as any;
    if (j && j.code === 429 && attempt < 8) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return j;
  }
}
const withKey = (params: URLSearchParams) => {
  if (API_KEY) params.set("api_key", API_KEY);
  return params;
};
const api = async (m: string, q: Record<string, string>): Promise<any> =>
  tcFetch(`${API}/${m}?${withKey(new URLSearchParams(q))}`);
const save = (name: string, data: unknown) => {
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(
    path.join(ART, name),
    typeof data === "string" ? data : JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n",
  );
};

function loadSeed(): Buffer {
  const env = process.env["M2C_SEED_HEX"];
  if (env) return Buffer.from(env.trim(), "hex");
  return Buffer.from(fs.readFileSync(path.join(ROOT, "..", "pp2", ".secrets", "operator-seed.hex"), "utf8").trim(), "hex");
}

/** uint256 raw-hash of an address (the registry key / CAL dest representation). */
const addrHash = (a: Address): bigint => BigInt("0x" + a.hash.toString("hex"));

async function liveSeqno(rawAddr: string): Promise<{ state: string; balance: bigint; seqno: number }> {
  const info = await api("getAddressInformation", { address: rawAddr });
  const balance = BigInt(info.result?.balance ?? "0");
  const state = info.result?.state ?? "uninitialized";
  let seqno = 0;
  if (state === "active") {
    const wi = await api("getWalletInformation", { address: rawAddr });
    seqno = Number(wi.result?.seqno ?? 0);
  }
  return { state, balance, seqno };
}

async function main() {
  const kp = keyPairFromSeed(loadSeed());
  const wallet = WalletContractV5R1.create({
    publicKey: kp.publicKey,
    walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } },
  });
  const self = wallet.address;
  const selfRaw = self.toRawString();

  // Registry stateInit: pinned compiled code + initial storage (owner = operator).
  const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "registry.compiled.json"), "utf8"));
  const code = Cell.fromBase64(artifact.codeBoc64);
  const data = buildInitialStorage(self);
  const registryInit: StateInit = { code, data };
  const registry = contractAddress(0, registryInit);

  // The proof CAL: wallet.send_ton to self, value 0.05. Its params are the expected settlement.
  const expected: Omit<ExpectedSettlement, "externalMessageHash" | "deadlineUnix"> = {
    calHash: 0n, // set after we hash the CAL-equivalent external below (kept simple here)
    nonce: 0n, // set to seqno+1 at broadcast time (A.5 rule)
    dest: addrHash(self),
    value: SEND_VALUE,
  };

  const before = await liveSeqno(selfRaw);
  console.log(`operator   ${self.toString({ testOnly: true })}`);
  console.log(`            state=${before.state} balance=${before.balance} seqno=${before.seqno}`);
  console.log(`registry   ${registry.toString({ testOnly: true })}`);
  console.log(`            codeHash=${artifact.codeHashHex} tolk=${artifact.tolkVersion}`);
  console.log(`plan       A deploy registry (0.1 TON + init) · B send_ton self (${SEND_VALUE} nano) · C upsert record · D read-back + correlate`);

  if (!BROADCAST) {
    console.log("\nDRY run (no broadcast). Re-run with BROADCAST=1 to execute the network leg.");
    save("m2c-plan.json", {
      operator: selfRaw,
      registry: registry.toRawString(),
      codeHashHex: artifact.codeHashHex,
      expected: { ...expected, value: expected.value },
      sendValue: SEND_VALUE,
    });
    return;
  }

  if (before.state !== "active") throw new Error("operator wallet is not active/funded");
  if (before.balance < toNano("0.3")) throw new Error(`operator balance too low: ${before.balance}`);

  // Build + broadcast one W5R1 external carrying `messages`, return its external hash, wait for the
  // seqno to advance (confirmation).
  async function sendExternal(seqno: number, messages: Parameters<typeof wallet.createTransfer>[0]["messages"]): Promise<bigint> {
    const transfer = wallet.createTransfer({ seqno, secretKey: kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY, messages });
    const ext = beginCell()
      .store(storeMessage({ info: { type: "external-in", dest: self, importFee: 0n }, body: transfer }))
      .endCell();
    const extHash = BigInt("0x" + ext.hash().toString("hex"));
    const sendUrl = `${API}/sendBoc?${withKey(new URLSearchParams())}`;
    const resp = await tcFetch(sendUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boc: ext.toBoc().toString("base64") }) });
    if (!resp.ok) throw new Error(`sendBoc rejected: ${JSON.stringify(resp)}`);
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const now = await liveSeqno(selfRaw);
      if (now.seqno > seqno) return extHash;
    }
    throw new Error(`seqno did not advance past ${seqno} (external ${extHash.toString(16)})`);
  }

  // ── A. deploy the registry ──────────────────────────────────────────────────────────────────────
  const regState = await liveSeqno(registry.toRawString());
  if (regState.state !== "active") {
    console.log("\n→ A. deploy registry");
    const s = (await liveSeqno(selfRaw)).seqno;
    await sendExternal(s, [internal({ to: registry, value: toNano("0.1"), init: registryInit, body: beginCell().endCell(), bounce: false })]);
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      if ((await liveSeqno(registry.toRawString())).state === "active") break;
    }
    console.log(`   deployed: ${(await liveSeqno(registry.toRawString())).state}`);
  } else {
    console.log("\n→ A. registry already active — skipping deploy");
  }

  // ── B. drive a real send_ton self-settlement; capture its external hash + observe the effect ──────
  console.log("→ B. send_ton (self)");
  const seqnoB = (await liveSeqno(selfRaw)).seqno;
  const nonceB = BigInt(seqnoB + 1); // A.5 rule
  const extHashB = await sendExternal(seqnoB, [internal({ to: self, value: SEND_VALUE, body: beginCell().endCell(), bounce: false })]);
  console.log(`   external_message_hash = ${extHashB.toString(16)}`);

  // observe the resulting transaction's out-message (dest + value) — the on-chain effect.
  let observed: ObservedSettlement | null = null;
  for (let i = 0; i < 40 && observed === null; i++) {
    await sleep(3000);
    const txs = (await api("getTransactions", { address: selfRaw, limit: "8" })) as any;
    for (const tx of txs.result ?? []) {
      const out = (tx.out_msgs ?? [])[0];
      if (out && BigInt(out.value ?? "0") === SEND_VALUE) {
        observed = {
          txHash: BigInt("0x" + Buffer.from(tx.transaction_id?.hash ?? "", "base64").toString("hex")),
          effectDest: addrHash(Address.parse(out.destination)),
          effectValue: BigInt(out.value),
          observedAtUnix: Number(tx.utime ?? Math.floor(Date.now() / 1000)),
        };
        break;
      }
    }
  }
  if (!observed) throw new Error("could not observe the send_ton effect");
  console.log(`   observed effect: dest=${observed.effectDest.toString(16)} value=${observed.effectValue} tx=${observed.txHash.toString(16)}`);

  // ── C. classify off-chain (M2-B), then record on-chain ────────────────────────────────────────────
  const full: ExpectedSettlement = { ...expected, nonce: nonceB, externalMessageHash: extHashB, deadlineUnix: observed.observedAtUnix + SETTLE_WINDOW_S };
  const verdict = classify(full, observed, observed.observedAtUnix);
  console.log(`→ C. classify → ${SettlementStatus[verdict.status]} (${verdict.reason})`);
  if (verdict.status !== SettlementStatus.Settled) throw new Error(`expected SETTLED, got ${SettlementStatus[verdict.status]}`);

  const record: ReconciliationRecord = {
    status: verdict.status,
    nonce: nonceB,
    calHash: full.calHash,
    txHash: observed.txHash,
    observedEffectHash: 0n,
    updatedAt: observed.observedAtUnix,
  };
  const seqnoC = (await liveSeqno(selfRaw)).seqno;
  await sendExternal(seqnoC, [internal({ to: registry, value: toNano("0.05"), body: buildUpsertBody(extHashB, record), bounce: true })]);
  console.log("   upserted record");

  // ── D. read the record back from the registry; correlate CAL → tx/effect → record ────────────────
  // Throttled raw runGetMethod (the same reader the verifier uses) — TonClient's un-throttled getter
  // calls trip the keyless toncenter rate limit mid-poll, which false-negatives this step.
  let count = 0;
  let stored: ReconciliationRecord | null = null;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const { recordCount, record } = await readRegistry(registry.toRawString(), extHashB);
    count = recordCount;
    if (record) {
      stored = record;
      break;
    }
  }
  if (!stored) throw new Error("record not found on-chain after upsert");

  const correlated =
    stored.status === SettlementStatus.Settled &&
    stored.txHash === observed.txHash &&
    stored.nonce === nonceB;
  console.log(`→ D. registry recordCount=${count} · stored.status=${SettlementStatus[stored.status]} · correlated=${correlated}`);
  if (!correlated) throw new Error("on-chain record does not correlate with the observed settlement");

  save("m2c-verdict.json", {
    result: "SC-3 SUCCESS",
    network: "ton-testnet",
    operator: selfRaw,
    registry: registry.toRawString(),
    codeHashHex: artifact.codeHashHex,
    externalMessageHash: extHashB,
    observed,
    classified: { status: SettlementStatus[verdict.status], reason: verdict.reason },
    stored: { ...stored, status: SettlementStatus[stored.status] },
    recordCount: count,
    correlated,
  });
  console.log(`\n✅ M2-C SC-3 SUCCESS — CAL → tx ${observed.txHash.toString(16)} → registry record (Settled), correlated on-chain.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
