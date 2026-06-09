#!/usr/bin/env node
// H3.5 (observer) — INDEPENDENT re-derivation of the PP#2 verdict from repo + live chain, WITHOUT
// trusting verdict.json. A third party runs this on a clean checkout (pinned toolchain) and gets the
// same verdict with no author involvement. It:
//   1. re-derives the expected effect from the committed CAL via canonical_to_inner (the mapping
//      under test) — not from any stored conclusion;
//   2. re-checks repo-internal encoding fidelity: inner.boc decodes (bocToIr) to that same IR, and
//      external.boc hashes to params.external_msg_hash;
//   3. fetches the recorded on-chain tx (by hash) from LIVE testnet and confirms its emitted effect
//      equals the re-derived expectation.
// Independent A.SUCCESS iff all three hold. Verdict rule: proof-package-2-spec.md §3.1.
//
//   cd pp2 && node --import tsx scripts/pp2-observer.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Cell, Address } from "@ton/core";
import { canonicalToInner } from "../../orchestrator/dist/w5/canonical-to-inner.js";
import { bocToIr } from "../src/ir-to-boc.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, "..", "artifacts", "pp2b");
const API = "https://testnet.toncenter.com/api/v2";
const rd = (n) => fs.readFileSync(path.join(ART, n), "utf8");
const jbig = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const checks = [];
const ok = (name, cond, detail = "") => { checks.push({ name, cond, detail }); };

// ── 1. re-derive expected effect from the committed CAL (exercise canonical_to_inner) ──
const cal = JSON.parse(rd("cal.json"));
for (const s of cal.steps) if (s?.params && typeof s.params.amount_nano === "string") s.params.amount_nano = BigInt(s.params.amount_nano);
const ir = canonicalToInner(cal);
const expected = ir.outActions.map((a) => ({ dest: a.msg.dest, value: a.msg.valueNano.toString() }));
ok("CAL → canonical_to_inner yields ≥1 action", ir.outActions.length > 0, jbig(expected));

// ── 2. repo-internal encoding fidelity (no chain) ──
const innerBoc = Buffer.from(rd("inner.boc.base64.txt").trim(), "base64");
const innerBack = bocToIr(innerBoc);
ok("inner.boc decodes to the same IR (ir_to_boc ⇄)", jbig(innerBack) === jbig(ir));

const params = JSON.parse(rd("params.json"));
const externalCell = Cell.fromBoc(Buffer.from(rd("external.boc.base64.txt").trim(), "base64"))[0];
ok("external.boc hash == params.external_msg_hash", externalCell.hash().toString("hex") === params.external_msg_hash, externalCell.hash().toString("hex"));

// ── 3. live chain: the recorded tx executed exactly the re-derived effect ──
const txMeta = JSON.parse(rd("tx.json"));
const addr = cal.agent_id;
const res = await (await fetch(`${API}/getTransactions?address=${addr}&limit=20`)).json();
const list = Array.isArray(res.result) ? res.result : [];
const tx = list.find((t) => t.transaction_id.hash === txMeta.tx_hash_b64);
ok("recorded tx_hash is present on live testnet", !!tx, txMeta.tx_hash_b64);

let effectMatch = false;
if (tx) {
  const out = tx.out_msgs?.[0];
  const onChain = out ? { dest: Address.parse(out.destination).toRawString(), value: String(out.value) } : null;
  effectMatch = !!onChain && expected.some((e) => e.dest === onChain.dest && e.value === onChain.value);
  ok("live on-chain effect == re-derived CAL effect (faithful dest+value)", effectMatch, JSON.stringify(onChain));
  ok("no authorization widening (⊆): exactly one out-msg, value not inflated", (tx.out_msgs?.length ?? 0) === expected.length && effectMatch);
}

// ── verdict ──
const allOk = checks.every((c) => c.cond);
console.log(`H3.5 observer — independent PP#2 re-derivation (repo + live testnet, no verdict.json):\n`);
for (const c of checks) console.log(`  ${c.cond ? "✅" : "❌"} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
console.log(allOk
  ? `\n✅ INDEPENDENT A.SUCCESS — a third party re-derives the PP#2 verdict from the repo + the live chain alone.`
  : `\n❌ independent re-derivation FAILED — inspect per §3.1 before classifying.`);
process.exit(allOk ? 0 : 1);
