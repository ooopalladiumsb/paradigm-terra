#!/usr/bin/env node
// PP#2-B — first real testnet transaction. CAL → canonical_to_inner → ir_to_boc + reference W5R1
// external → (sendBoc) → tx_hash → on-chain effect. Saves every intermediate artifact so the
// success / publication-layer / freeze-reopen verdict (proof-package-2-spec.md §3.1) is decided from
// DATA, not reconstruction.
//
//   node --import tsx scripts/pp2b-run.mjs            # DRY: build + save artifacts, NO broadcast
//   BROADCAST=1 node --import tsx scripts/pp2b-run.mjs # build + broadcast + poll tx_hash + effect
//
// Envelope = reference @ton/ton WalletContractV5R1 (A.5 decision); inner mapping = our
// canonical_to_inner; inner serialization = our ir_to_boc (saved + round-trip-checked). The deploy
// rides on the first external (seqno 0, init attached) → CAL nonce 1 (== seqno+1, the A.5 rule).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cr from "@ton/crypto";
import { beginCell, internal, storeMessage, SendMode, Address } from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { canonicalToInner } from "../../orchestrator/dist/w5/canonical-to-inner.js";
import { irToCell, bocToIr, irToBocBase64 } from "../src/ir-to-boc.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, "..", "artifacts", "pp2b");
const API = "https://testnet.toncenter.com/api/v2";
const BROADCAST = process.env["BROADCAST"] === "1";

fs.mkdirSync(ART, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(ART, name), typeof data === "string" ? data : JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
const api = async (m, q) => (await fetch(`${API}/${m}?${new URLSearchParams(q)}`)).json();

// ── identity (same key/address as PP#2-B.0) ──
const seed = Buffer.from(fs.readFileSync(path.join(HERE, "..", ".secrets", "operator-seed.hex"), "utf8").trim(), "hex");
const kp = cr.keyPairFromSeed(seed);
const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: kp.publicKey, walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } } });
const self = wallet.address;
const selfRaw = self.toRawString();

// ── live account state ──
const info = await api("getAddressInformation", { address: selfRaw });
const balance = BigInt(info.result?.balance ?? "0");
const state = info.result?.state;
let seqno = 0; // uninitialized ⇒ 0
if (state === "active") { const wi = await api("getWalletInformation", { address: selfRaw }); seqno = Number(wi.result?.seqno ?? 0); }
if (balance === 0n) { console.error("❌ address has 0 balance — fund it first"); process.exit(1); }
console.log(`account: state=${state} balance=${balance} → seqno=${seqno}`);

// ── the proof CAL: wallet.send_ton to self, nonce = seqno+1 (A.5 rule), generous expiration ──
const SEND_VALUE = 50_000_000n; // 0.05 TON, self-send (observable, returns to self)
const cal = {
  cal_version: "0.1.0", action: "wallet.send_ton", agent_id: selfRaw, nonce: BigInt(seqno + 1),
  expiration_tick: 1_000_000n,
  preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${selfRaw}` }, rhs: { const: 1n } },
  invariants: [], steps: [{ verb: "wallet.send_ton", params: { to: selfRaw, amount_nano: SEND_VALUE }, post_conditions: [] }], receipt_required: true,
};
if (cal.nonce !== BigInt(seqno + 1)) { console.error("❌ A.5 invariant cal.nonce == seqno+1 violated"); process.exit(1); }

// ── CAL → InnerRequest (our mapping) → our ir_to_boc (saved + round-trip checked) ──
const ir = canonicalToInner(cal);
const innerRoundTrip = bocToIr(irToCell(ir).toBoc());
const expectedEffect = { dest: selfRaw, value_nano: SEND_VALUE.toString() };

// ── reference W5R1 external (A.5: envelope from the reference builder; inner from the same IR msgs) ──
const validUntil = Math.floor(Date.now() / 1000) + 120; // tight window ⇒ TON-valid ⊆ CAL-valid by construction
const messages = ir.outActions.map((a) => internal({ to: Address.parseRaw(a.msg.dest), value: a.msg.valueNano, bounce: false, body: beginCell().endCell() }));
const transferBody = wallet.createTransfer({ seqno, secretKey: kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY, messages, timeout: validUntil });
const externalCell = beginCell().store(storeMessage({ info: { type: "external-in", src: null, dest: self, importFee: 0n }, init: seqno === 0 ? wallet.init : undefined, body: transferBody })).endCell();
const externalBocB64 = externalCell.toBoc().toString("base64");
const externalHash = externalCell.hash().toString("hex");

// ── save the full pre-broadcast trail ──
save("cal.json", cal);
save("inner.json", ir);
save("inner.boc.base64.txt", irToBocBase64(ir));
save("external.boc.base64.txt", externalBocB64);
save("params.json", { network: "ton-testnet", address: selfRaw, seqno, nonce: cal.nonce, valid_until: validUntil, send_mode: "PAY_GAS_SEPARATELY(1)", expected_effect: expectedEffect, external_msg_hash: externalHash, deploy: seqno === 0 });

console.log(`\nCAL → IR → BOC built (artifacts in pp2/artifacts/pp2b/):`);
const jbig = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
console.log(`  inner round-trip ok : ${jbig(innerRoundTrip) === jbig(ir)}`);
console.log(`  expected effect     : send ${SEND_VALUE} to ${selfRaw} (self)`);
console.log(`  valid_until         : ${validUntil} (now+120s) — TON-valid ⊆ CAL-valid by construction`);
console.log(`  external msg hash   : ${externalHash}`);
console.log(`  external boc bytes  : ${externalCell.toBoc().length}  (deploy=${seqno === 0})`);

if (!BROADCAST) {
  console.log(`\nDRY run — nothing sent. Re-run with BROADCAST=1 to send; then scripts/pp2b-verify.mjs for the verdict.`);
  process.exit(0);
}

// ── broadcast ──
console.log(`\n→ sendBoc …`);
const sendResp = await (await fetch(`${API}/sendBoc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boc: externalBocB64 }) })).json();
save("sendboc-response.json", sendResp);
if (!sendResp.ok) { console.error("❌ sendBoc rejected:", JSON.stringify(sendResp)); process.exit(1); }
console.log(`  sendBoc accepted: ${JSON.stringify(sendResp.result ?? sendResp.ok)}`);

// ── find the PROOF tx: external-driven (no in_msg.source) with ≥1 out_msg — NOT the follow-on
//    incoming leg of a self-send (which has 0 out_msgs). ──
console.log(`→ polling for the external-driven transaction …`);
const isProofTx = (t) => !(t.in_msg && t.in_msg.source) && (t.out_msgs?.length ?? 0) > 0;
let tx = null;
for (let i = 0; i < 30; i++) {
  const txs = await api("getTransactions", { address: selfRaw, limit: "8" });
  const list = Array.isArray(txs.result) ? txs.result : [];
  const cands = list.filter(isProofTx).sort((a, b) => Number(BigInt(b.transaction_id.lt) - BigInt(a.transaction_id.lt)));
  if (cands.length > 0) { tx = cands[0]; break; }
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 4000));
}
console.log("");
if (!tx) { console.error("❌ no external-driven transaction observed — check explorer"); process.exit(1); }

const txHash = tx.transaction_id.hash;
const out = tx.out_msgs?.[0];
const onChainEffect = out ? { dest: out.destination, value_nano: out.value } : null;
save("tx.json", { tx_hash_b64: txHash, lt: tx.transaction_id.lt, out_msgs: tx.out_msgs, on_chain_effect: onChainEffect });

console.log(`\ntx_hash (base64): ${txHash}`);
console.log(`tx_hash (hex)   : ${Buffer.from(txHash, "base64").toString("hex")}`);
console.log(`on-chain effect : ${JSON.stringify(onChainEffect)}`);
console.log(`expected effect : dest=${selfRaw} value=${SEND_VALUE}`);

// ── PP#2-C verdict (§3.1) ──
const destMatch = onChainEffect && Address.parse(onChainEffect.dest).toRawString() === selfRaw;
const valueMatch = onChainEffect && BigInt(onChainEffect.value_nano) === SEND_VALUE;
save("verdict.json", { tx_hash_hex: Buffer.from(txHash, "base64").toString("hex"), expected_effect: expectedEffect, on_chain_effect: onChainEffect, dest_match: !!destMatch, value_match: !!valueMatch });
if (destMatch && valueMatch) {
  console.log(`\n✅ PP#2 SUCCESS — tx_hash≠null, finalized, on-chain effect == CAL action (faithful dest+value).`);
} else {
  console.log(`\n⚠ effect mismatch — apply §3.1 discriminator: our encoding faithful (PP#2-A round-trip ✓) ⇒ candidate C (model gap); inspect tx.json/external.boc before classifying.`);
}
