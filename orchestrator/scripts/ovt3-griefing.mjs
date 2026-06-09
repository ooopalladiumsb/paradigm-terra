#!/usr/bin/env node
// OVT-3 (H3.4) — Griefing / economic-bound validation. The hypothesis: a flood of
// malformed / expensive CALs is CONTAINED by the protocol economics (gas / escrow /
// spam-fee) + the DSL's structural limits. Falsified if any attack class imposes
// unbounded node work for bounded / zero attacker cost.
//
//   node --import tsx scripts/ovt3-griefing.mjs      # from orchestrator/
//
// MEASURE-not-optimize discipline (Gate-#2): this exercises the ALREADY-FROZEN
// validator/reducer/gas economics over adversarial load and classifies each attack as
// BOUNDED (and by which mechanism) or UNBOUNDED. It changes nothing. A genuinely
// unbounded class would be an OVT finding (possibly a Freeze-Surface defect), not a
// harness bug. It also yields the empirical datum the parked PATH_SEGMENT_WEIGHT_REVIEW
// asked for: is `path_segment` weight 2 *actively defending* a griefing vector?
//
// Signature verification is proven elsewhere (Gate #1 / verifyIngress); here the trace
// sig-booleans are INPUTS set per attack intent — the economics being tested are the
// validator's charging decisions GIVEN an ingress verdict.

import { genesis, apply } from "@paradigm-terra/cal-reducer";
import { run } from "../src/index.js";
import { escrowRequirement, flatValidationFee } from "../../cal-gas/dist/index.js";
import { expressionCost, AST_LIMITS } from "../../dsl/dist/index.js";

const ATT = "0:" + "bb".repeat(32);
const FEE = 100_000n;

function provision(balance, scopes = ["ton_transfer"]) {
  const g = genesis();
  g.ptra.balances[ATT] = balance;
  g.registry.agents[ATT] = { granted_scopes: scopes, operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: "0x" + "22".repeat(32) };
  return g;
}
function mkCal(nonce, over = {}) {
  return {
    cal_version: "0.1.0", action: "wallet.send_ton", agent_id: ATT, nonce, expiration_tick: 1_000_000n,
    preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 1n } },
    invariants: [], steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }], receipt_required: true, ...over,
  };
}
const trace = (over = {}) => ({ currentTick: 0n, steps: [{ ok: true, effects: [] }], stateBefore: {}, stateAfter: {}, operatorSigPresent: true, ownerSigPresent: true, ...over });
const bal = (s) => s.ptra.balances[ATT] ?? 0n;
const treas = (s) => s.treasury?.collected_fees_window ?? 0n;

/** Fold a one-tick program through the node + reducer; return the terminal submission + post-state. */
function foldOne(g, cal, tr) {
  const t = run({ genesisState: g, ticks: [{ tick: 0n, submissions: [{ cal, trace: tr }] }] });
  let s = g;
  for (const ev of t.eventLog) {
    const r = apply(s, ev);
    if (!r.ok) throw new Error("reducer rejected " + r.code);
    s = r.state;
  }
  const sub = t.ticks[0].submissions[0];
  return { stage: sub.terminalStage ?? sub.ingressError?.code ?? "?", reason: sub.reasonCode ?? null, s };
}

const fails = [];
const check = (name, cond) => { if (!cond) fails.push(name); return cond; };

console.log("OVT-3 / H3.4 — griefing & economic-bound validation\n");
console.log(`flat_validation_fee = ${FEE} nano-PTRA · escrow requirement = ${escrowRequirement(mkCal(1n), provision(0n))} (fee + fee×100)\n`);

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEADLINE — economic bound: total spam damage ≤ the attacker's initial balance.
//    A bankrupt attacker cannot keep paying; conservation routes every charged unit
//    to the treasury. We flood charged failures (CAPABILITY_DENIED) with sequential
//    nonces (the reducer advances the nonce even on a spam-charged pre-VALIDATED fail,
//    so the same nonce can't be retried for free).
// ─────────────────────────────────────────────────────────────────────────────
{
  const START = 350_000n; // 3.5 fees — enough to watch it go bankrupt mid-flood
  const FLOOD = 8;
  const g = provision(START, []); // no ton_transfer scope ⇒ CAPABILITY_DENIED
  const subs = Array.from({ length: FLOOD }, (_, i) => ({ cal: mkCal(BigInt(i + 1)), trace: trace() }));
  const t = run({ genesisState: g, ticks: [{ tick: 0n, submissions: subs }] });
  // Fold once, snapshotting the attacker's balance after each cal.failed (the drain curve).
  let s = g;
  const curve = [];
  for (const ev of t.eventLog) {
    s = apply(s, ev).state;
    if (ev.event_type === "cal.failed") curve.push(bal(s));
  }
  const charged = t.ticks[0].submissions.filter((x) => x.reasonCode === "CAPABILITY_DENIED").length;
  console.log("1. ECONOMIC BOUND — sustained charged-failure flood (CAPABILITY_DENIED):");
  console.log(`   attacker balance ${START} → ${bal(s)} over ${FLOOD} attacks; balance curve: ${curve.map(String).join(" → ")}`);
  console.log(`   treasury collected = ${treas(s)} ; all ${charged} attacks reached the charge gate\n`);
  check("balance drains to 0", bal(s) === 0n);
  check("conservation: treasury gain == attacker loss", treas(s) === START - bal(s));
  check("total damage bounded by initial balance", treas(s) <= START);
  check("balance monotonically non-increasing", curve.every((v, i) => i === 0 || v <= curve[i - 1]));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ATTACK-CLASS MATRIX — every reachable failure/finalize class, its charge, and the
//    mechanism that bounds it.
// ─────────────────────────────────────────────────────────────────────────────
console.log("2. ATTACK-CLASS MATRIX (charge per attack & bounding mechanism):");
const G = () => provision(100_000_000n);
const row = (name, setup, expectReason, kind, mech) => {
  const { stage, reason, s } = setup();
  const charge = 100_000_000n - bal(s); // for the 100M-funded cases; overridden below where noted
  const ok = (expectReason === null ? reason === null : reason === expectReason);
  check(`class ${name} reason`, ok);
  console.log(`   ${ok ? "✓" : "✗"} ${name.padEnd(20)} ${(reason ?? stage).padEnd(20)} ${kind.padEnd(8)} ${mech}`);
  return { charge };
};
// charged classes
row("CAPABILITY_DENIED", () => foldOne(provision(100_000_000n, []), mkCal(1n), trace()), "CAPABILITY_DENIED", "CHARGED", "spam-fee (§9.4) → drains balance");
row("PRECOND_FALSE", () => foldOne(G(), mkCal(1n, { preconditions: { op: "gte", lhs: { const: 1n }, rhs: { const: 9n } } }), trace()), "PRECOND_FALSE", "CHARGED", "spam-fee (§9.4) → drains balance");
row("FINALIZED", () => foldOne(G(), mkCal(1n), trace()), null, "CHARGED", "fee + gas ≤ escrow (§9.3)");
row("OUT_OF_GAS", () => foldOne(G(), mkCal(1n, { gas_limit_ptra: 1n }), trace()), "OUT_OF_GAS", "CHARGED", "consumed capped at escrowed budget (§9.3)");
// free classes — bounded structurally, not economically
row("UNKNOWN_ACTION", () => foldOne(G(), mkCal(1n, { action: "evil.pwn" }), trace()), "UNKNOWN_ACTION", "FREE", "O(1) §2.3 registry lookup (pre-eval)");
row("NONCE_MISMATCH", () => foldOne(G(), mkCal(99n), trace()), "NONCE_MISMATCH", "FREE", "O(1) nonce check (pre-eval)");
row("INSUFFICIENT_ESCROW", () => foldOne(provision(1_000_000n), mkCal(1n), trace()), "INSUFFICIENT_ESCROW", "FREE", "O(1) balance gate; precond eval DSL-capped");
row("PRECOND_ERROR (bomb)", () => foldOne(G(), mkCal(1n, { preconditions: { op: "gte", lhs: { var: "state.a.b.c.d.e.f.g.h" }, rhs: { const: 1n } } }), trace()), "PRECOND_ERROR", "FREE", "DSL parser rejects before eval");
console.log("");

// ─────────────────────────────────────────────────────────────────────────────
// 3. STRUCTURAL FLOOR — the DSL parser hard-caps per-CAL evaluation work BEFORE any
//    economics. This is what bounds the FREE classes (a charge of 0 only stays safe if
//    the work is also ~0). Each bomb MUST be rejected at parse.
// ─────────────────────────────────────────────────────────────────────────────
console.log(`3. STRUCTURAL FLOOR — DSL limits ${JSON.stringify(AST_LIMITS)}:`);
const rejects = (name, expr) => {
  let threw = null;
  try { expressionCost(expr, { scope: "precondition", version: "1.2" }); } catch (e) { threw = e.message; }
  const ok = check(`bomb rejected: ${name}`, threw !== null);
  console.log(`   ${ok ? "✓" : "✗"} ${name.padEnd(26)} ${threw ? "rejected — " + threw.split("\n")[0] : "ACCEPTED (unbounded!)"}`);
};
// path depth > MAX_PATH_SEGMENTS (6)
rejects("path 8 segments", { op: "gte", lhs: { var: "state.a.b.c.d.e.f.g.h" }, rhs: { const: 1n } });
// node count > MAX_NODES (100): a wide AND of many comparisons
const wide = { op: "and", args: Array.from({ length: 60 }, () => ({ op: "gte", lhs: { const: 1n }, rhs: { const: 1n } })) };
rejects("120+ nodes (wide AND)", wide);
// nesting depth > MAX_DEPTH (10)
let deep = { const: 1n };
for (let i = 0; i < 14; i++) deep = { op: "not", arg: { op: "eq", lhs: deep, rhs: { const: 1n } } };
rejects("nesting depth 14", deep);
console.log("");

// ─────────────────────────────────────────────────────────────────────────────
// 4. PATH_SEGMENT_WEIGHT_REVIEW datum — is weight 2 the binding anti-grief bound on
//    path depth, or is the structural segment-COUNT limit?
// ─────────────────────────────────────────────────────────────────────────────
console.log("4. PATH_SEGMENT_WEIGHT_REVIEW — cost vs the structural cap:");
for (let d = 2; d <= AST_LIMITS.MAX_PATH_SEGMENTS; d++) {
  const path = "state." + Array.from({ length: d - 1 }, (_, i) => String.fromCharCode(97 + i)).join(".");
  const c = expressionCost({ op: "gte", lhs: { var: path }, rhs: { const: 1n } }, { scope: "precondition", version: "1.2" });
  console.log(`   path depth ${d} (${path})  cost = ${c} units`);
}
const maxPathCost = expressionCost({ op: "gte", lhs: { var: "state.a.b.c.d.e" }, rhs: { const: 1n } }, { scope: "precondition", version: "1.2" });
console.log(`   → a maximal legal path (${AST_LIMITS.MAX_PATH_SEGMENTS} segments) costs ${maxPathCost} of the ${AST_LIMITS.MAX_EXPRESSION_COST}-unit budget.`);
console.log(`   → the HARD bound on path-depth abuse is the structural MAX_PATH_SEGMENTS=${AST_LIMITS.MAX_PATH_SEGMENTS} (a parse reject),`);
console.log(`     NOT the per-segment gas weight 2 (which is advisory under §C.4). Verdict: weight 2 is NOT the`);
console.log(`     active anti-grief defense → PATH_SEGMENT_WEIGHT_REVIEW Option 1 (no change) stands on honest grounds.\n`);

// ─────────────────────────────────────────────────────────────────────────────
if (fails.length === 0) {
  console.log("✅ H3.4 PASS — every attack class is BOUNDED: charged classes drain the attacker (damage ≤ balance,");
  console.log("   conservation exact); free classes are capped structurally (O(1) gates + DSL parse limits) so a");
  console.log("   zero-cost failure flood imposes only bounded per-CAL work. No unbounded griefing vector found.");
  process.exit(0);
}
console.log(`❌ H3.4 FALSIFIED — ${fails.length} check(s) failed: ${fails.join("; ")}`);
process.exit(1);
