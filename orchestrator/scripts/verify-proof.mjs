#!/usr/bin/env node
// Verify Proof Package #1 (Gate #4) — re-derive the package from its OWN contents through the
// live code, so it is falsifiable rather than narrated. Reads docs/proofs/proof-package-1.json,
// rebuilds the signed CAL, and:
//   1. recomputes cal_hash from the CAL                  → must equal the stored cal_hash
//   2. re-runs verifyIngress() over the REAL signatures  → must re-derive the stored verdict
//      (the owner_sig is verified against THIS cal's canonical bytes — so a pass proves the real
//       wallet signed exactly this CAL; corrupting any byte flips ownerSigPresent to false)
//   3. re-runs the live node run() (validate → reduce)   → must reach FINALIZED with the stored
//      event sequence, state roots, and event-log Merkle root
// Exit 0 iff every check passes. Pair with assemble-proof.mjs (which produced the package).
//
//   node orchestrator/scripts/verify-proof.mjs [path-to-proof.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalUnsignedBytes, calHash } from "@paradigm-terra/cal";
import { genesis } from "@paradigm-terra/cal-reducer";
import { run, verifyIngress } from "../src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const file = process.argv[2] ?? path.join(ROOT, "docs/proofs/proof-package-1.json");
const j = JSON.parse(fs.readFileSync(file, "utf8"));
const toHex = (b) => "0x" + Buffer.from(b).toString("hex");

// Revive DSL integer constants (JSON numbers) back to bigint for canonical encoding.
const reviveExpr = (n) => {
  if (n === null || typeof n !== "object") return n;
  if ("const" in n) return typeof n.const === "number" ? { const: BigInt(n.const) } : { const: n.const };
  if ("var" in n) return { var: n.var };
  const out = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === "args") out[k] = v.map(reviveExpr);
    else if (k === "lhs" || k === "rhs" || k === "arg") out[k] = reviveExpr(v);
    else out[k] = v;
  }
  return out;
};

const c = j.cal;
const cal = {
  cal_version: c.cal_version,
  action: c.action,
  agent_id: c.agent_id,
  nonce: BigInt(c.nonce),
  expiration_tick: BigInt(c.expiration_tick),
  preconditions: reviveExpr(c.preconditions),
  invariants: (c.invariants ?? []).map(reviveExpr),
  steps: c.steps.map((s) => ({ verb: s.verb, params: s.params ?? {}, post_conditions: s.post_conditions ?? [] })),
  receipt_required: c.receipt_required,
};

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok, detail }); };

// 1. cal_hash
const recomputed = toHex(calHash(cal));
check("cal_hash matches", recomputed === j.cal_hash, recomputed === j.cal_hash ? "" : `got ${recomputed} ≠ ${j.cal_hash}`);

// 2. ingress crypto over the REAL signatures (owner_sig vs THIS cal's canonical bytes)
const signedCal = {
  ...cal,
  signatures: {
    operator_sig: j.signatures.operator_sig,
    owner_sig: {
      signature: j.signatures.owner_sig.signature,
      domain: j.signatures.owner_sig.domain,
      timestamp: BigInt(j.signatures.owner_sig.timestamp),
      workchain: BigInt(j.signatures.owner_sig.workchain),
      address_hash: j.signatures.owner_sig.address_hash,
    },
  },
};
const reg = { operator_pubkey: j.operator_pubkey, owner_pubkey: j.owner_pubkey };
const verdict = verifyIngress(signedCal, reg);
check("operator_sig verifies (raw Ed25519 over canonical_bytes)", verdict.operatorSigPresent === true);
check("owner_sig verifies (Contract A over THIS cal — real wallet capture)", verdict.ownerSigPresent === true);
check("ingress verdict matches stored", verdict.operatorSigPresent === j.ingress_verdict.operatorSigPresent && verdict.ownerSigPresent === j.ingress_verdict.ownerSigPresent);

// Negative control: flip one byte of the owner signature → ownerSigPresent MUST go false (teeth).
const tampered = "0x" + (j.signatures.owner_sig.signature.slice(2, 4) === "00" ? "ff" : "00") + j.signatures.owner_sig.signature.slice(4);
const negVerdict = verifyIngress({ ...signedCal, signatures: { ...signedCal.signatures, owner_sig: { ...signedCal.signatures.owner_sig, signature: tampered } } }, reg);
check("negative control: tampered owner_sig → false", negVerdict.ownerSigPresent === false);

// 3. live node fold (validate → reduce) → FINALIZED + matching roots
const A = cal.agent_id;
const g = genesis();
g.ptra.balances[A] = 10n ** 18n;
g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: j.operator_pubkey, owner_pubkey: j.owner_pubkey };
const trace = { currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: verdict.operatorSigPresent, ownerSigPresent: verdict.ownerSigPresent };
const t = run({ genesisState: g, ticks: [{ tick: 0n, submissions: [{ cal: signedCal, trace }] }] });
const sub = t.ticks[0].submissions[0];

check("terminal stage FINALIZED", sub.terminalStage === "FINALIZED", `got ${sub.terminalStage}`);
const gotTypes = sub.events.map((e) => e.event_type);
const expTypes = j.validator_observation.events.map((e) => e.event_type);
check("event sequence matches", JSON.stringify(gotTypes) === JSON.stringify(expTypes), `got ${gotTypes.join("→")}`);
check("state_root_before matches", (sub.stateRoots[0] ?? null) === j.finalized_observation.state_root_before);
check("state_root_after matches", (sub.stateRoots[sub.stateRoots.length - 1] ?? null) === j.finalized_observation.state_root_after);
check("event_log Merkle root matches", t.ticks[0].globalMerkleRoot === j.finalized_observation.event_log_root);

// report
console.log(`\nProof Package #1 verification — ${path.relative(ROOT, file)} (status ${j.status})\n`);
let allOk = true;
for (const c of checks) {
  console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  allOk = allOk && c.ok;
}
console.log(`\n${allOk ? "✅ ALL CHECKS PASS — the LIVE package is a real, reproducible ingress→validate→reduce→finalized run." : "❌ VERIFICATION FAILED"}`);
process.exit(allOk ? 0 : 1);
