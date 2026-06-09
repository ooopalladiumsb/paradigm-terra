// Differential fuzzer for the three @paradigm-terra/cal-gas implementations
// (TypeScript reference, Rust parity, Go parity).
//
// Generates random, well-formed (cal, state, bytes_written) inputs and feeds the
// identical batch to all three language harnesses, which each emit the gas units,
// the §9.3 escrow + admission gate, and the full §9.4 bill for ALL SIX outcomes.
// Any disagreement (the gas layer is a pure, deterministic Tier-3 function) is
// flagged. Inputs are bounded well below the U256 range so checked-uint sums never
// overflow in Rust/Go while staying unbounded in TS — otherwise an "overflow vs
// not" split would be a generator artifact, not a real divergence.
//
// Usage: node cal-gas/fuzz/driver.mjs [--cases N] [--seed S] [--show K]
// Exit: 0 = all agree, 1 = divergence(s), 2 = harness/protocol error.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical } from "@paradigm-terra/canonical";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const RS_BASE = resolve(ROOT, "cal-gas-rs/target/x86_64-unknown-linux-musl");
const RS_BIN = existsSync(resolve(RS_BASE, "release/fuzz_harness"))
  ? resolve(RS_BASE, "release/fuzz_harness")
  : resolve(RS_BASE, "debug/fuzz_harness");

const HARNESSES = {
  ts: { cmd: "node", args: [resolve(HERE, "ts_harness.mjs")] },
  rs: { cmd: RS_BIN, args: [] },
  go: { cmd: resolve(HERE, "bin", "gas_go_harness"), args: [] },
};

const argv = process.argv.slice(2);
const getArg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const N = Number.parseInt(getArg("--cases", "5000"), 10);
const SEED = Number.parseInt(getArg("--seed", String(Date.now() >>> 0)), 10);
const SHOW = Number.parseInt(getArg("--show", "8"), 10);

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(SEED);
const ri = (n) => Math.floor(rng() * n);
const pick = (a) => a[ri(a.length)];
const chance = (p) => rng() < p;
const randBig = (bits) => {
  let n = 0n;
  for (let i = 0; i < Math.ceil(bits / 8); i++) n = (n << 8n) | BigInt(ri(256));
  return n;
};

const AGENTS = ["0:" + "a".repeat(64), "0:" + "b".repeat(64)];
const VERBS = ["wallet.send_ton", "treasury.transfer", "oracles.get_feed", "wallet.get_balance"];

// Bounded, well-formed DSL expression (structural cost only; any scope is fine for
// the cost model). Depth-limited so expressionCost stays cheap and finite.
function genExpr(depth) {
  const r = rng();
  if (depth <= 0 || r < 0.4) return { const: randBig(16) };
  if (r < 0.7) {
    // Plain `state.*` segments only — `state.before.*`/`state.after.*` are valid
    // solely in post-condition/invariant scope, and the cost is structural (2 per
    // segment) regardless of the name, so this loses no coverage while keeping
    // every generated expression cost-computable in every scope.
    const segs = 1 + ri(4);
    let path = "state";
    for (let i = 0; i < segs; i++) path += "." + pick(["x", "y", "z", "treasury", "nav", "balances"]);
    return { var: path };
  }
  if (r < 0.9) return { op: pick(["eq", "lt", "gte", "add", "sub"]), lhs: genExpr(depth - 1), rhs: genExpr(depth - 1) };
  return { op: "and", args: [genExpr(depth - 1), genExpr(depth - 1)] };
}

function genCal() {
  const agent = pick(AGENTS);
  const nSteps = ri(4);
  const steps = [];
  for (let i = 0; i < nSteps; i++) {
    const pcs = [];
    for (let j = 0; j < ri(3); j++) pcs.push(genExpr(2));
    steps.push({ verb: pick(VERBS), params: { i: BigInt(i) }, post_conditions: pcs });
  }
  const invs = [];
  for (let i = 0; i < ri(3); i++) invs.push(genExpr(2));
  const cal = {
    cal_version: "0.1.0",
    action: pick(VERBS),
    agent_id: agent,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: genExpr(3),
    invariants: invs,
    steps,
    receipt_required: true,
    signatures: { operator_sig: "0x" + "ab".repeat(64) },
  };
  if (chance(0.5)) cal.gas_limit_ptra = randBig(40); // else default fee×100
  return { cal, agent };
}

function genState(agent) {
  const params = {};
  if (chance(0.6)) params.flat_validation_fee_nano_ptra = randBig(ri(2) ? 80 : 20); // mix big + near-fee
  return {
    cal: { in_flight: {}, nonces: {} },
    failure_mode: { is_bounded_mode: false, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: pick([1n, 1000n, randBig(20)]), genesis_validator_set: [], params },
    oracles: { feeds: {} },
    ptra: { balances: { [agent]: randBig(ri(3) ? 80 : 16) } }, // sometimes below the fee → min(fee,balance)
    registry: { agents: {}, mcp_schema_hash: "0x" + "00".repeat(32) },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

function genCase() {
  const { cal, agent } = genCal();
  return { cal, state: genState(agent), bytes_written: BigInt(ri(5000)) };
}

mkdirSync(resolve(HERE, "out"), { recursive: true });
const cases = [];
const lines = [];
for (let c = 0; c < N; c++) {
  const text = serializeCanonical(genCase());
  cases.push(text);
  lines.push(Buffer.from(text, "utf8").toString("hex"));
}
const batch = lines.join("\n") + "\n";

function runHarness(h) {
  try {
    return execFileSync(h.cmd, h.args, { input: batch, maxBuffer: 1 << 30, encoding: "utf8" }).split("\n").filter((l) => l.length > 0);
  } catch (e) {
    console.error(`harness failed (${h.cmd}): ${e.message}`);
    process.exit(2);
  }
}

const results = { ts: runHarness(HARNESSES.ts), rs: runHarness(HARNESSES.rs), go: runHarness(HARNESSES.go) };
for (const k of ["ts", "rs", "go"]) {
  if (results[k].length !== N) {
    console.error(`protocol error: ${k} returned ${results[k].length} lines, expected ${N}`);
    process.exit(2);
  }
}

const divergences = [];
for (let i = 0; i < N; i++) {
  const t = results.ts[i], r = results.rs[i], g = results.go[i];
  if (!(t === r && r === g)) divergences.push({ index: i, ts: t, rs: r, go: g, case: cases[i] });
}

mkdirSync(resolve(HERE, "out"), { recursive: true });
const outPath = resolve(HERE, "out", "gas_divergences.jsonl");
writeFileSync(outPath, "");
for (const d of divergences) appendFileSync(outPath, JSON.stringify(d) + "\n");

let ok = 0;
for (const line of results.ts) if (line.startsWith("OK")) ok++;
console.log(`seed=${SEED} cases=${N}`);
console.log(`outcomes: ${ok} OK, ${N - ok} ERR`);
if (divergences.length === 0) {
  console.log(`✅ 0 divergences — TS / Rust / Go agree on gas units, escrow, and all §9.4 bills.`);
  process.exit(0);
}
console.log(`❌ ${divergences.length} divergence(s). First ${Math.min(SHOW, divergences.length)}:`);
for (const d of divergences.slice(0, SHOW)) console.log(JSON.stringify(d));
process.exit(1);
