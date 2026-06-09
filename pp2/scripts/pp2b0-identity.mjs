#!/usr/bin/env node
// PP#2-B.0 — identity (NO on-chain write, NO network state change).
//
// Generate (once) a throwaway testnet operator key, derive the Wallet-V5R1 address, and pin the
// PUBLIC identity into the committed artifact trail. The private seed is written to a gitignored
// .secrets/ file (0600), never printed, never committed — the harness reuses it on later phases
// (deploy / sendBoc) so the address is stable. §10.2 holds by construction: operator_pubkey IS the
// deployed wallet's public_key.
//
//   node scripts/pp2b0-identity.mjs            # from pp2/
//
// Output: pp2/artifacts/pp2-identity.json (public) + the testnet address to fund from the faucet.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WalletContractV5R1 } from "@ton/ton";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET_DIR = path.join(HERE, "..", ".secrets");
const SEED_FILE = path.join(SECRET_DIR, "operator-seed.hex");
const ART_DIR = path.join(HERE, "..", "artifacts");
const ART_FILE = path.join(ART_DIR, "pp2-identity.json");

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

// one-time operator seed, persisted gitignored (reused across PP#2 phases)
function loadOrCreateSeed() {
  if (fs.existsSync(SEED_FILE)) return Buffer.from(fs.readFileSync(SEED_FILE, "utf8").trim(), "hex");
  fs.mkdirSync(SECRET_DIR, { recursive: true });
  const seed = crypto.randomBytes(32);
  fs.writeFileSync(SEED_FILE, seed.toString("hex"), { mode: 0o600 });
  return seed;
}

const seed = loadOrCreateSeed();
const sk = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const pub = crypto.createPublicKey(sk).export({ type: "spki", format: "der" }).subarray(-32); // raw 32-byte ed25519 pubkey

// Testnet W5R1: networkGlobalId = -3 (mainnet would be -239); workchain 0; subwallet 0.
const walletId = { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } };
const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.from(pub), walletId });

const fundAddress = wallet.address.toString({ testOnly: true, bounceable: false }); // 0Q… — fund an undeployed wallet non-bounceable

const artifact = {
  phase: "PP#2-B.0 (identity — no on-chain write)",
  network: "ton-testnet",
  wallet_version: "v5r1",
  workchain: 0,
  operator_pubkey_hex: Buffer.from(pub).toString("hex"),
  wallet_id: walletId,
  address: {
    raw: wallet.address.toRawString(),
    testnet_bounceable: wallet.address.toString({ testOnly: true, bounceable: true }),
    testnet_nonbounceable_FUND_THIS: fundAddress,
  },
  toolchain: { "@ton/ton": "16.3.0", "@ton/core": "0.63.1" },
  secret_location: ".secrets/operator-seed.hex (gitignored, 0600 — NOT in this artifact)",
  generated_at: new Date().toISOString(),
  note:
    "§10.2 operator_pubkey == deployed wallet public_key holds by construction. No transaction sent; " +
    "this only derives the address. Next (after funding): deploy → read live seqno → build external " +
    "(cal.nonce == seqno+1, tight valid_until) → sendBoc → tx_hash → effect check. Verdict rule: " +
    "proof-package-2-spec.md §3.1.",
};

fs.mkdirSync(ART_DIR, { recursive: true });
fs.writeFileSync(ART_FILE, JSON.stringify(artifact, null, 2) + "\n", "utf8");

console.log("PP#2-B.0 identity (NO on-chain write):\n");
console.log("  network          ton-testnet (networkGlobalId -3)");
console.log("  wallet version   v5r1, workchain 0, subwallet 0");
console.log("  operator pubkey  " + artifact.operator_pubkey_hex);
console.log("  address (raw)    " + artifact.address.raw);
console.log("  ┌─ FUND THIS (testnet, non-bounceable) ───────────────────────────");
console.log("  │  " + fundAddress);
console.log("  └──────────────────────────────────────────────────────────────────");
console.log("\n  artifact → " + path.relative(path.join(HERE, "..", ".."), ART_FILE));
console.log("  secret   → .secrets/operator-seed.hex (gitignored; reused for deploy/sign)");
console.log("\n  Next: fund the address above via @testgiver_ton_bot, then GO PP#2-B (deploy + sendBoc).");
