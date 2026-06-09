#!/usr/bin/env node
// PP#2-C — read-only verdict from the on-chain transaction (no broadcast, no rebuild). Finds the
// external-driven proof tx (in_msg = external, ≥1 out_msg) and checks effect fidelity against the
// CAL's authorized action. Writes artifacts/pp2b/{tx.json, verdict.json}. Verdict rule: §3.1.
//
//   node scripts/pp2b-verify.mjs            # from pp2/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Address } from "@ton/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, "..", "artifacts", "pp2b");
const API = "https://testnet.toncenter.com/api/v2";
const save = (n, d) => fs.writeFileSync(path.join(ART, n), JSON.stringify(d, null, 2) + "\n");

const SELF_RAW = "0:ca2f3b312b44854d9f6e72cd0c2e38a48697b446f20fce3098744fc16a77db80";
const EXPECTED = { dest: SELF_RAW, value_nano: "50000000" }; // the CAL's authorized wallet.send_ton

const txs = await (await fetch(`${API}/getTransactions?address=${SELF_RAW}&limit=10`)).json();
const list = Array.isArray(txs.result) ? txs.result : [];
const isProof = (t) => !(t.in_msg && t.in_msg.source) && (t.out_msgs?.length ?? 0) > 0; // external-in with emitted out_msg
const proof = list.filter(isProof).sort((a, b) => Number(BigInt(b.transaction_id.lt) - BigInt(a.transaction_id.lt)))[0];
if (!proof) { console.error("❌ no external-driven proof tx found on-chain"); process.exit(1); }

const out = proof.out_msgs[0];
const txHashHex = Buffer.from(proof.transaction_id.hash, "base64").toString("hex");
const onChain = { dest: Address.parse(out.destination).toRawString(), value_nano: String(out.value) };
const destMatch = onChain.dest === EXPECTED.dest;
const valueMatch = onChain.value_nano === EXPECTED.value_nano;
const success = destMatch && valueMatch;

save("tx.json", { tx_hash_b64: proof.transaction_id.hash, tx_hash_hex: txHashHex, lt: proof.transaction_id.lt, in_msg_external: true, out_msgs: proof.out_msgs });
save("verdict.json", {
  phase: "PP#2-B/C", network: "ton-testnet", address: SELF_RAW,
  tx_hash_hex: txHashHex, expected_effect: EXPECTED, on_chain_effect: onChain,
  dest_match: destMatch, value_match: valueMatch,
  verdict: success ? "A.SUCCESS" : "inspect (§3.1 B-vs-C discriminator)",
  note: success
    ? "tx_hash != null, finalized, on-chain effect == CAL action (faithful dest+value). TON-valid ⊆ CAL-valid held. No Freeze Surface contradiction."
    : "effect mismatch — apply §3.1: our encoding faithful (PP#2-A round-trip) ⇒ candidate C; inspect.",
});

console.log(`PP#2-B/C verdict (read-only, on-chain):`);
console.log(`  proof tx_hash (hex): ${txHashHex}`);
console.log(`  on-chain effect    : dest=${onChain.dest} value=${onChain.value_nano}`);
console.log(`  expected effect    : dest=${EXPECTED.dest} value=${EXPECTED.value_nano}`);
console.log(`  dest match=${destMatch}  value match=${valueMatch}`);
console.log(success ? `\n✅ PP#2 SUCCESS — full chain CAL → canonical_to_inner → ir_to_boc → W5 external → TON → effect == expected.` : `\n⚠ inspect per §3.1 before classifying.`);
