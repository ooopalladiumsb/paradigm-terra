#!/usr/bin/env node
// Gate #2 — TS ns/op benchmark harness (per docs/notes/gate2-benchmark-plan.md).
//
// MEASURE, do not optimize. Produces a baseline: median ns/op per gas-priced operation class,
// and the ratio to the DSL-binary-op peg, checked against the [0.5×, 2.0×] band of each class's
// abstract weight. Out-of-band cells are FLAGGED as Tier-2 candidates — never auto-tuned here.
//
//   node --import tsx bench/gas-bench.mjs            # from cal-gas/
//
// What is measured: the per-op EVALUATION traversal cost — `evaluate(ast, bindings, scope)` with
// the AST parsed ONCE outside the timed loop. The gas weights (binary 1 / path 2 / gate 5 /
// contains_key 10 / size 20) are a proxy for evaluation work, so parse overhead (a fixed ~µs per
// call) must be excluded or it swamps the marginal per-op cost and compresses every ratio toward 1.
// MCP and state-rent classes time their cal-gas primitives directly (no DSL).
//
// Methodology: ≥2000 warmup iters; median over 99 batches of innerK reps (ns/op = batchNs/innerK).
// Every result is summed into a sink printed at the end, defeating V8 dead-code elimination
// (additive, not XOR — equal-length outcome codes must not cancel). ns/op is machine-relative;
// the RATIO to the peg is the portable signal (it cancels absolute machine/runtime speed).

import { parseExpression, evaluate } from "@paradigm-terra/dsl";
import { mcpCallUnits, effectsBytes } from "../src/index.js";

let SINK = 0; // consumed (additively) to defeat DCE
const consume = (v) => {
  if (typeof v === "bigint") SINK += Number(v % 1000000n);
  else if (v && typeof v === "object" && "code" in v) SINK += v.code === "EVALUATION_TRUE" ? 1 : v.code === "EVALUATION_FALSE" ? 2 : 7;
  else SINK += 1;
  if (SINK > 1e15) SINK = SINK % 1e9; // keep it a small double, still result-dependent
};

// median ns/op: warmup, then 99 batches of innerK reps; ns/op = batchNs/innerK; median of batches.
function benchNsPerOp(fn, { warmup = 2000, batches = 99, innerK = 1000 } = {}) {
  for (let i = 0; i < warmup; i++) consume(fn());
  const samples = [];
  for (let b = 0; b < batches; b++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < innerK; i++) consume(fn());
    const dt = process.hrtime.bigint() - t0;
    samples.push(Number(dt) / innerK);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

// --- bindings ---
const stateBind = { state: { x: 1n, a: { b: { c: { d: { e: 1n } } } }, m: { k: 1n }, arr: [1n, 2n, 3n] } };
const invBind = { before: { x: 1n }, after: { x: 1n } };

// pre-parse an expression once; return a zero-arg fn that times only evaluation.
function evalOp(input, scope, bindings) {
  const ast = parseExpression(input, { scope, version: "1.2" });
  const outcome = evaluate(ast, bindings, scope); // self-check sample
  return { fn: () => evaluate(ast, bindings, scope), outcome };
}

// --- DSL operation classes (single op, minimal operands; AST parsed once) ---
const binaryPeg = evalOp({ op: "eq", lhs: { const: 1n }, rhs: { const: 1n } }, "precondition", {});
const containsKey = evalOp({ op: "contains_key", lhs: { var: "state.m" }, rhs: { const: "k" } }, "precondition", stateBind);
const size = evalOp({ op: "gte", lhs: { op: "size", arg: { var: "state.arr" } }, rhs: { const: 0n } }, "precondition", stateBind);
const gateOp = evalOp({ op: "is_owner_required", args: [{ const: "treasury.transfer" }] }, "gate", stateBind);
const invariantBase = evalOp({ op: "gte", lhs: { var: "state.after.x" }, rhs: { const: 0n } }, "invariant", invBind);
// path-segment per-segment marginal via slope (deep var minus shallow var ÷ segment delta).
const shallowVar = evalOp({ op: "eq", lhs: { var: "state.x" }, rhs: { const: 1n } }, "precondition", stateBind); // 2 segs
const deepVar = evalOp({ op: "eq", lhs: { var: "state.a.b.c.d.e" }, rhs: { const: 1n } }, "precondition", stateBind); // 6 segs

// --- self-check: every parsed expression must evaluate without a DSL error ---
const probes = { binaryPeg, containsKey, size, gateOp, invariantBase, shallowVar, deepVar };
const bad = Object.entries(probes).filter(([, o]) => o.outcome.code !== "EVALUATION_TRUE" && o.outcome.code !== "EVALUATION_FALSE");
if (bad.length) {
  console.error("SELF-CHECK FAILED (expression did not evaluate cleanly):");
  for (const [k, o] of bad) console.error(`  ${k}: ${o.outcome.code}${o.outcome.reason ? "/" + o.outcome.reason : ""}`);
  process.exit(1);
}

// 1 KiB-ish committed effects value for the state-rent encode class.
const kib = [{ ns: "ptra", op: "set", path: "state.ptra.balances.x", value: "0x" + "ab".repeat(496) }];

// --- run benchmarks ---
const peg = benchNsPerOp(binaryPeg.fn);
const nsShallow = benchNsPerOp(shallowVar.fn);
const nsDeep = benchNsPerOp(deepVar.fn);
const nsPerSegment = (nsDeep - nsShallow) / 4; // 6 - 2 = 4 extra segments

const rows = [];
const band = (w) => [0.5 * w, 2.0 * w];
const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
const status = (ratio, w) => { const [lo, hi] = band(w); return ratio >= lo && ratio <= hi ? "IN" : "OUT"; };
const dslRow = (cls, ns, w, note) => rows.push({ cls, ns, ratio: ns / peg, w, lo: band(w)[0], hi: band(w)[1], mark: status(ns / peg, w), note });

rows.push({ cls: "binary op (peg)", ns: peg, ratio: 1.0, w: 1, lo: null, hi: null, mark: "peg", note: "eq(const,const)" });
dslRow("path segment", nsPerSegment, 2, "slope: var(6seg)−var(2seg) ÷4");
dslRow("gate op", benchNsPerOp(gateOp.fn), 5, "is_owner_required(const) @gate");
dslRow("contains_key", benchNsPerOp(containsKey.fn), 10, "contains_key(var,const)");
dslRow("size", benchNsPerOp(size.fn), 20, "gte(size(var),0)");
dslRow("invariant base", benchNsPerOp(invariantBase.fn), 5, "gte(var(after.x),0) @invariant");

// MCP classes (synthetic: validator-side CPU is verb classification only; real cost is off-chain).
for (const [cls, verb, w] of [["mcp read", "agent.get_balance", 50], ["mcp write", "agent.transfer", 200]]) {
  const ns = benchNsPerOp(() => mcpCallUnits(verb));
  rows.push({ cls: cls + " (synthetic)", ns, ratio: ns / peg, w, lo: band(w)[0], hi: band(w)[1], mark: "SYNTH", note: "mcpCallUnits" });
}
// state-rent per byte (encode IS the measured op).
{
  const nsEncode = benchNsPerOp(() => effectsBytes(kib), { innerK: 200 });
  const bytes = Number(effectsBytes(kib));
  const nsByte = nsEncode / bytes;
  dslRow(`state-rent / byte (${bytes}B encode)`, nsByte, 1, "effectsBytes ÷ bytes");
}

// --- report ---
console.log(`\nGate #2 — TS ns/op baseline (peg = binary op = ${fmt(peg)} ns/op)\n`);
console.log("| class | ns/op | ratio | weight | band | status | op |");
console.log("|---|--:|--:|--:|---|---|---|");
for (const r of rows) {
  const bandStr = r.lo == null ? "—" : `[${r.lo}, ${r.hi}]`;
  console.log(`| ${r.cls} | ${fmt(r.ns)} | ${r.ratio.toFixed(2)} | ${r.w} | ${bandStr} | ${r.mark} | ${r.note} |`);
}
const outs = rows.filter((r) => r.mark === "OUT");
console.log(`\n${outs.length === 0 ? "✅ all measurable cells IN band" : "⚠ OUT-of-band (Tier-2 candidates, NOT to fix here): " + outs.map((r) => r.cls).join(", ")}`);
console.log(`(synthetic rows: MCP — validator-side CPU is verb classification only; real MCP cost is off-chain, band not applicable.)`);
console.error(`sink=${SINK}`); // keep the optimizer honest
