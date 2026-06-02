#!/usr/bin/env node
// OVT-1 layer falsification test — replace Proof Package #1's HAND-BUILT trace with one GENERATED
// by the MCP executor over real MCP calls, and require the CAL to still reach FINALIZED with
// BYTE-IDENTICAL roots. If that holds, the trace was generated, not asserted (H1.2); the executor's
// view of the server matches the registry pin (H1.3); and an unknown verb is rejected from the
// server's advertised list, proving the executor consults the server, not a rubber stamp (H1.1).
//
//   node --import tsx scripts/ovt1-executor-proof.mjs      # from orchestrator/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalUnsignedBytes, calHash } from "@paradigm-terra/cal";
import { genesis } from "@paradigm-terra/cal-reducer";
import { run, verifyIngress } from "../src/index.js";
import { McpExecutor } from "../src/mcp/executor.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const j = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/proofs/proof-package-1.json"), "utf8"));
const expectedSchemaHash = fs.readFileSync(path.join(ROOT, "tools/mcp/mcp-schema-v1.hash"), "utf8").trim();
const pinnedToolCount = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/mcp/mcp-schema-v1-tools.json"), "utf8")).length;
const toHex = (b) => "0x" + Buffer.from(b).toString("hex");

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
  cal_version: c.cal_version, action: c.action, agent_id: c.agent_id,
  nonce: BigInt(c.nonce), expiration_tick: BigInt(c.expiration_tick),
  preconditions: reviveExpr(c.preconditions), invariants: (c.invariants ?? []).map(reviveExpr),
  steps: c.steps.map((s) => ({ verb: s.verb, params: s.params ?? {}, post_conditions: s.post_conditions ?? [] })),
  receipt_required: c.receipt_required,
};

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

const exec = new McpExecutor();
const serverPath = path.join(ROOT, "orchestrator/src/mcp/test-server.mjs");
await exec.connect(process.execPath, [serverPath]);

try {
  // H1.3 — the executor's view of the live server reproduces the registry pin.
  const schema = exec.schemaHashHex();
  check(`schema hash from live tools/list == registry pin`, schema === expectedSchemaHash, schema === expectedSchemaHash ? `${schema.slice(0, 12)}…` : `got ${schema}`);
  check(`server advertises the full pinned toolset (${pinnedToolCount} tools)`, exec.advertisedTools().length === pinnedToolCount, `${exec.advertisedTools().length} tools`);

  // H1.2 — GENERATE the execution record over real MCP calls.
  const rec = await exec.executeCal(cal, { currentTick: 0n, stateBefore: {} });
  const stepsMatch = rec.steps.length === 1 && rec.steps[0].ok === true && rec.steps[0].effects.length === 0;
  check(`executor-generated steps == proof's hand-built trace ([{ok:true,effects:[]}])`, stepsMatch, JSON.stringify(rec.steps));

  // Layer test — the GENERATED trace drives the live node to FINALIZED with identical roots.
  const signedCal = {
    ...cal,
    signatures: {
      operator_sig: j.signatures.operator_sig,
      owner_sig: {
        signature: j.signatures.owner_sig.signature, domain: j.signatures.owner_sig.domain,
        timestamp: BigInt(j.signatures.owner_sig.timestamp), workchain: BigInt(j.signatures.owner_sig.workchain),
        address_hash: j.signatures.owner_sig.address_hash,
      },
    },
  };
  const verdict = verifyIngress(signedCal, { operator_pubkey: j.operator_pubkey, owner_pubkey: j.owner_pubkey });
  check(`cal_hash unchanged`, toHex(calHash(cal)) === j.cal_hash);

  const trace = { ...rec, operatorSigPresent: verdict.operatorSigPresent, ownerSigPresent: verdict.ownerSigPresent };
  const A = cal.agent_id;
  const g = genesis();
  g.ptra.balances[A] = 10n ** 18n;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: j.operator_pubkey, owner_pubkey: j.owner_pubkey };
  const t = run({ genesisState: g, ticks: [{ tick: 0n, submissions: [{ cal: signedCal, trace }] }] });
  const sub = t.ticks[0].submissions[0];
  const fin = j.finalized_observation;

  check(`terminal stage FINALIZED (executor-driven)`, sub.terminalStage === "FINALIZED", sub.terminalStage);
  check(`event sequence matches`, JSON.stringify(sub.events.map((e) => e.event_type)) === JSON.stringify(j.validator_observation.events.map((e) => e.event_type)));
  check(`state_root_before identical`, (sub.stateRoots[0] ?? null) === fin.state_root_before);
  check(`state_root_after identical`, (sub.stateRoots[sub.stateRoots.length - 1] ?? null) === fin.state_root_after);
  check(`event_log Merkle root identical`, t.ticks[0].globalMerkleRoot === fin.event_log_root);

  // H1.1 negative control — an unknown verb is rejected from the server's advertised list.
  const neg = await exec.executeCal({ steps: [{ verb: "wallet.NONEXISTENT_TOOL", params: {} }] }, { currentTick: 0n, stateBefore: {} });
  check(`negative control: unknown verb → STEP_ERROR (executor consults server)`, neg.steps[0].ok === false && /UNKNOWN_TOOL/.test(neg.steps[0].errorDetail ?? ""), neg.steps[0].errorDetail);
} finally {
  await exec.close();
}

console.log(`\nOVT-1 — MCP executor falsification test (Proof Package #1, status ${j.status})\n`);
let allOk = true;
for (const c of checks) { console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? "  — " + c.detail : ""}`); allOk = allOk && c.ok; }
console.log(`\n${allOk ? "✅ OVT-1 executor: trace GENERATED over real MCP calls reproduces FINALIZED with identical roots (H1.1–H1.3)." : "❌ OVT-1 FAILED"}`);
process.exit(allOk ? 0 : 1);
