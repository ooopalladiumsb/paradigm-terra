// Differential fuzzer for the three @paradigm-terra/cal-validator implementations
// (TypeScript reference, Rust parity, Go parity).
//
// Generates random (cal, snapshot, trace) inputs — biased to exercise every gate
// of the §3.1 pipeline, especially the §9.4 Tier-2 pre-VALIDATED spam-charge gates
// (PRECOND_FALSE / CAPABILITY_DENIED with varied balances → min(fee, balance)) —
// and feeds the identical batch to all three harnesses. Each emits the event-type
// sequence, terminal stage, reason code, the economic event fields, and the full
// §9.4 bill. The validator is pure & deterministic, so zero divergence is required.
// Integers are bounded well below U256 so checked-uint sums never overflow.
//
// Usage: node validator/fuzz/driver.mjs [--cases N] [--seed S] [--show K]
// Exit: 0 = all agree, 1 = divergence(s), 2 = harness/protocol error.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical } from "@paradigm-terra/canonical";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const RS_BASE = resolve(ROOT, "validator-rs/target/x86_64-unknown-linux-musl");
const RS_BIN = existsSync(resolve(RS_BASE, "release/fuzz_harness"))
  ? resolve(RS_BASE, "release/fuzz_harness")
  : resolve(RS_BASE, "debug/fuzz_harness");

const HARNESSES = {
  ts: { cmd: "node", args: [resolve(HERE, "ts_harness.mjs")] },
  rs: { cmd: RS_BIN, args: [] },
  go: { cmd: resolve(HERE, "bin", "validator_go_harness"), args: [] },
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

const A = "0:" + "a".repeat(64);
const MISSING = "0:" + "f".repeat(64); // absent from balances → MISSING_VAR
const SIG = "0x" + "ab".repeat(64);
// Registered actions (see §2.3 taxonomy); "frob.nicate" is intentionally unregistered.
const ACTIONS = ["wallet.send_ton", "treasury.transfer", "oracles.get_feed", "frob.nicate"];
const SCOPE_SETS = [[], ["ton_transfer"], ["treasury_access:transfer"], ["ton_transfer", "treasury_access:transfer"]];

const TRUE = { op: "gte", lhs: { const: 1n }, rhs: { const: 0n } };
const FALSE = { op: "gte", lhs: { const: 0n }, rhs: { const: 1n } };
const ERRX = { op: "gte", lhs: { var: `state.ptra.balances.${MISSING}` }, rhs: { const: 0n } }; // MISSING_VAR

function precond() {
  // plain state.* only (before/after are out-of-scope for preconditions)
  return pick([TRUE, FALSE, ERRX, { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: randBig(20) } }]);
}
function baExpr() {
  // post-condition / invariant: may read state.before / state.after
  return pick([TRUE, FALSE, { op: "lt", lhs: { var: "state.after.x" }, rhs: { var: "state.before.x" } }, { op: "eq", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } }]);
}

function genCal() {
  const nSteps = ri(3);
  const steps = [];
  for (let i = 0; i < nSteps; i++) {
    const pcs = [];
    for (let j = 0; j < ri(2); j++) pcs.push(baExpr());
    steps.push({ verb: pick(ACTIONS), params: { i: BigInt(i) }, post_conditions: pcs });
  }
  const invs = [];
  for (let i = 0; i < ri(2); i++) invs.push(baExpr());
  const cal = {
    cal_version: "0.1.0",
    // mostly registered actions (deeper pipeline coverage); ~12% unregistered → UNKNOWN_ACTION
    action: chance(0.12) ? "frob.nicate" : pick(["wallet.send_ton", "treasury.transfer", "oracles.get_feed"]),
    agent_id: A,
    nonce: chance(0.8) ? 1n : randBig(8),
    expiration_tick: chance(0.85) ? 100n : BigInt(ri(3)),
    preconditions: precond(),
    invariants: invs,
    steps,
    receipt_required: true,
    signatures: chance(0.5) ? { operator_sig: SIG, owner_sig: SIG } : { operator_sig: SIG },
  };
  if (chance(0.4)) cal.gas_limit_ptra = randBig(40);
  return { cal, nSteps };
}

function genSnapshot() {
  const params = {};
  if (chance(0.5)) params.flat_validation_fee_nano_ptra = randBig(ri(2) ? 80 : 18);
  return {
    cal: { in_flight: {}, nonces: { [A]: chance(0.8) ? 0n : randBig(8) } },
    failure_mode: { is_bounded_mode: false, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: pick([1n, 1000n, randBig(16)]), genesis_validator_set: [], params },
    oracles: { feeds: {} },
    ptra: { balances: { [A]: pick([0n, randBig(16), randBig(40), randBig(80)]) } }, // span below/above the fee
    registry: { agents: { [A]: { granted_scopes: pick(SCOPE_SETS) } }, mcp_schema_hash: "0x" + "00".repeat(32) },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

function genTrace(nSteps) {
  const steps = [];
  for (let i = 0; i < nSteps; i++) {
    const ok = chance(0.8);
    const s = { ok, effects: ok ? [{ ns: "ptra", op: "set", path: ["counters", "x"], value: randBig(12) }] : [] };
    if (!ok) s.error_detail = "reverted";
    steps.push(s);
  }
  return {
    current_tick: chance(0.85) ? 0n : BigInt(1 + ri(300)), // sometimes past a short expiration
    owner_sig_present: chance(0.5),
    state_before: { x: randBig(8), treasury: { nav: randBig(8) } },
    state_after: { x: randBig(8), treasury: { nav: randBig(8) } },
    steps,
  };
}

function genCase() {
  const { cal, nSteps } = genCal();
  return { cal, cal_hash: "0x" + "11".repeat(32), snapshot: genSnapshot(), trace: genTrace(nSteps) };
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
const reasons = {};
for (let i = 0; i < N; i++) {
  const t = results.ts[i], r = results.rs[i], g = results.go[i];
  if (!(t === r && r === g)) divergences.push({ index: i, ts: t, rs: r, go: g, case: cases[i] });
  const m = t.split("|");
  const key = m.length > 2 ? `${m[1]}/${m[2]}` : t.slice(0, 12);
  reasons[key] = (reasons[key] || 0) + 1;
}

const outPath = resolve(HERE, "out", "validator_divergences.jsonl");
writeFileSync(outPath, "");
for (const d of divergences) appendFileSync(outPath, JSON.stringify(d) + "\n");

console.log(`seed=${SEED} cases=${N}`);
console.log(`coverage (stage/reason): ${JSON.stringify(reasons)}`);
if (divergences.length === 0) {
  console.log(`✅ 0 divergences — TS / Rust / Go agree on events, stage, reason, and §9.4 bill.`);
  process.exit(0);
}
console.log(`❌ ${divergences.length} divergence(s). First ${Math.min(SHOW, divergences.length)}:`);
for (const d of divergences.slice(0, SHOW)) console.log(JSON.stringify(d));
process.exit(1);
