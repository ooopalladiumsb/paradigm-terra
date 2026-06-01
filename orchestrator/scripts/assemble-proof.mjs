#!/usr/bin/env node
// Assemble Proof Package #1 (Gate #4). DRY-RUN self-signs operator + owner with generated keys
// to prove the machinery reaches FINALIZED and emits every field. LIVE reads a real owner_sig
// capture (one TON Connect wallet session over THIS CAL's canonical bytes).
//
//   node orchestrator/scripts/assemble-proof.mjs                      # dry-run → proof-package-1-dryrun.json
//   node orchestrator/scripts/assemble-proof.mjs --print-canonical    # base64(canonical_bytes) to sign live
//   node orchestrator/scripts/assemble-proof.mjs --owner-capture f.json  # live → proof-package-1.json
//
// Schema + field semantics: docs/proofs/README.md.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalUnsignedBytes, calHash } from "@paradigm-terra/cal";
import { genesis } from "@paradigm-terra/cal-reducer";
import { signDataDigest } from "@paradigm-terra/cal-validator";
import { run, verifyIngress } from "../src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = path.join(ROOT, "docs/proofs");

const A = "0:" + "aa".repeat(32);
const A_HASH = "aa".repeat(32);
const FUND = 10n ** 18n;
const toHex = (b) => "0x" + Buffer.from(b).toString("hex");
const rawPub = (pk) => { const d = pk.export({ type: "spki", format: "der" }); return d.subarray(d.length - 32).toString("hex"); };

// Deterministic CAL — its canonical bytes are reproducible for a live signer.
const cal = {
  cal_version: "0.1.0",
  action: "wallet.send_ton",
  agent_id: A,
  nonce: 1n,
  expiration_tick: 100n,
  preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
  invariants: [],
  steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
  receipt_required: true,
};
const canonical = canonicalUnsignedBytes(cal);
const canonicalB64 = Buffer.from(canonical).toString("base64");

if (process.argv.includes("--print-canonical")) {
  console.log("CAL canonical_bytes (sign THIS as signData/binary payload.bytes):");
  console.log(canonicalB64);
  console.log("\ncal_hash:", toHex(calHash(cal)));
  process.exit(0);
}

// operator_sig — programmatic agent-runtime key (always generated; raw Ed25519 over canonical bytes)
const opKp = crypto.generateKeyPairSync("ed25519");
const OP_PUB = "0x" + rawPub(opKp.publicKey);
const operatorSig = toHex(crypto.sign(null, Buffer.from(canonical), opKp.privateKey));

// owner_sig — LIVE capture or DRY-RUN self-sign
const captureArg = process.argv.indexOf("--owner-capture");
let status, ownerPub, ownerEnv, transport;
if (captureArg !== -1) {
  status = "LIVE";
  const cap = JSON.parse(fs.readFileSync(process.argv[captureArg + 1], "utf8"));
  ownerPub = cap.owner_pubkey;
  ownerEnv = { signature: cap.signature, domain: cap.domain, timestamp: BigInt(cap.timestamp), workchain: BigInt(cap.workchain ?? 0), address_hash: cap.address_hash };
  transport = { tc_session_id: cap.tc_session_id ?? null, trace_id: cap.trace_id ?? null, tx_hash: cap.tx_hash ?? null };
} else {
  status = "DRY-RUN";
  const ownerKp = crypto.generateKeyPairSync("ed25519");
  ownerPub = "0x" + rawPub(ownerKp.publicKey);
  const ts = 1780211353n;
  const digest = signDataDigest({ workchain: 0, addressHashHex: A_HASH, domain: "ooopalladiumsb.github.io", timestamp: ts, payload: { type: "binary", bytesB64: canonicalB64 } });
  ownerEnv = { signature: toHex(crypto.sign(null, digest, ownerKp.privateKey)), domain: "ooopalladiumsb.github.io", timestamp: ts, workchain: 0n, address_hash: "0x" + A_HASH };
  transport = { tc_session_id: null, trace_id: null, tx_hash: null };
}

const signedCal = { ...cal, signatures: { operator_sig: operatorSig, owner_sig: ownerEnv } };
const reg = { operator_pubkey: OP_PUB, owner_pubkey: ownerPub };
const verdict = verifyIngress(signedCal, reg);

const g = genesis();
g.ptra.balances[A] = FUND;
g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: OP_PUB, owner_pubkey: ownerPub };

const trace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: verdict.operatorSigPresent, ownerSigPresent: verdict.ownerSigPresent };
const t = run({ genesisState: g, ticks: [{ tick: 0n, submissions: [{ cal: signedCal, trace }] }] });
const tick = t.ticks[0];
const sub = tick.submissions[0];

const proof = {
  proof_package: "PROOF_PACKAGE_1",
  status,
  generated_at: new Date().toISOString(),
  agent_id: A,
  operator_pubkey: OP_PUB,
  owner_pubkey: ownerPub,
  wallet_address: "0:" + (ownerEnv.address_hash.replace(/^0x/, "")),
  cal,
  cal_hash: toHex(calHash(cal)),
  cal_id: toHex(calHash(cal)),
  signatures: signedCal.signatures,
  transport,
  ingress_verdict: verdict,
  trace,
  validator_observation: { events: sub.events, terminal_stage: sub.terminalStage, reason_code: sub.reasonCode },
  finalized_observation: { state_root_before: sub.stateRoots[0] ?? null, state_root_after: sub.stateRoots[sub.stateRoots.length - 1] ?? null, event_log_root: tick.globalMerkleRoot },
  timestamps: { owner_sig_unix: ownerEnv.timestamp, tick: tick.tick, cal_expiration_tick: cal.expiration_tick },
};

const ok = verdict.operatorSigPresent && verdict.ownerSigPresent && sub.terminalStage === "FINALIZED";
const file = path.join(OUT_DIR, status === "LIVE" ? "proof-package-1.json" : "proof-package-1-dryrun.json");
const json = JSON.stringify(proof, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);
fs.writeFileSync(file, json + "\n");

console.log(`${ok ? "✅" : "❌"} ${status}: ingress=${JSON.stringify(verdict)} terminal=${sub.terminalStage}`);
console.log(`   → ${path.relative(ROOT, file)}`);
if (!ok) { console.log("   (LIVE: if ownerSigPresent=false, the capture doesn't match THIS CAL's canonical bytes)"); process.exit(1); }
