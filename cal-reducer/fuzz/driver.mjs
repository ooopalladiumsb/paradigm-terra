// Differential fuzzer for the three @paradigm-terra/cal-reducer implementations
// (TypeScript reference, Rust parity, Go parity).
//
// Generates random, model-guided CAL event sequences (mostly valid lifecycles so
// the fold runs deep, with occasional faults for error-path coverage), feeds the
// identical batch to all three language harnesses, and flags any case where they
// disagree on the resulting STATE_ROOT OR on the (ApplyError code, index). The
// reducer is a total, deterministic Tier-3 function (§7.2), so zero divergence is
// required.
//
// Usage: node cal-reducer/fuzz/driver.mjs [--cases N] [--seed S] [--show K]
// Exit: 0 = all agree, 1 = divergence(s), 2 = harness/protocol error.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical } from "@paradigm-terra/canonical";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

// Prefer the optimized release harness (much faster); fall back to debug.
const RS_BASE = resolve(ROOT, "cal-reducer-rs/target/x86_64-unknown-linux-musl");
const RS_BIN = existsSync(resolve(RS_BASE, "release/fuzz_harness"))
  ? resolve(RS_BASE, "release/fuzz_harness")
  : resolve(RS_BASE, "debug/fuzz_harness");

const HARNESSES = {
  ts: { cmd: "node", args: [resolve(HERE, "ts_harness.mjs")] },
  rs: { cmd: RS_BIN, args: [] },
  go: { cmd: resolve(HERE, "bin", "reducer_go_harness"), args: [] },
};

const argv = process.argv.slice(2);
const getArg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const N = Number.parseInt(getArg("--cases", "5000"), 10);
const SEED = Number.parseInt(getArg("--seed", String(Date.now() >>> 0)), 10);
const SHOW = Number.parseInt(getArg("--show", "8"), 10);

// deterministic PRNG
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
const randHex = (nibbles) => {
  let s = "";
  for (let i = 0; i < nibbles; i++) s += ri(16).toString(16);
  return s;
};

const AGENTS = [
  "0:" + "a".repeat(64),
  "0:" + "b".repeat(64),
  "0:" + "1234567890abcdef".repeat(4),
];
const FUND = 10n ** 24n;
const SYMBOLS = ["TON/USD", "BTC/USD", "PTRA/TON"];

function genesisFunded() {
  const balances = {};
  for (const a of AGENTS) balances[a] = FUND;
  return {
    cal: { in_flight: {}, nonces: {} },
    failure_mode: { is_bounded_mode: false, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: 1000n, genesis_validator_set: [], params: {} },
    oracles: { feeds: {} },
    ptra: { balances },
    registry: { agents: {}, mcp_schema_hash: "0x" + "00".repeat(32) },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

const NEXT = { CREATED: "cal.signed", SIGNED: "cal.validated", VALIDATED: "cal.executed", EXECUTED: "cal.settled", SETTLED: "cal.finalized" };
const STAGE_AFTER = { "cal.signed": "SIGNED", "cal.validated": "VALIDATED", "cal.executed": "EXECUTED", "cal.settled": "SETTLED" };

function genCase() {
  const events = [];
  const inFlight = new Map(); // agent -> { cal, stage }
  let tick = 0n;
  let calCounter = 0;
  const newHash = () => "0x" + (calCounter++).toString(16).padStart(64, "0");
  const len = 1 + ri(40);

  for (let i = 0; i < len; i++) {
    const agent = pick(AGENTS);
    const fl = inFlight.get(agent);

    if (fl) {
      if (chance(0.1)) {
        // invalid: wrong-stage transition (terminates the fold with BAD_STAGE)
        events.push({ event_type: "cal.validated", cal_hash: fl.cal, fee_debited_ptra: randBig(20) });
        break;
      }
      if (chance(0.2)) {
        // terminate validly
        events.push({ event_type: chance(0.5) ? "cal.failed" : "cal.expired", cal_hash: fl.cal });
        inFlight.delete(agent);
        continue;
      }
      const et = NEXT[fl.stage];
      const ev = { event_type: et, cal_hash: fl.cal };
      if (et === "cal.validated") ev.fee_debited_ptra = chance(0.05) ? randBig(96) : randBig(28);
      if (et === "cal.executed") {
        ev.gas_consumed_ptra = randBig(28);
        ev.effects = [{ ns: "treasury", op: "add", path: ["nav"], value: randBig(20) }];
      }
      if (et === "cal.finalized") ev.gas_refunded_ptra = randBig(18);
      events.push(ev);
      if (et === "cal.finalized") inFlight.delete(agent);
      else fl.stage = STAGE_AFTER[et];
      continue;
    }

    // agent free
    const roll = rng();
    if (roll < 0.45) {
      const cal = newHash();
      events.push({ event_type: "cal.created", cal_hash: cal, agent_id: agent });
      inFlight.set(agent, { cal, stage: "CREATED" });
    } else if (roll < 0.65) {
      events.push({ event_type: "ptra.transferred", from: agent, to: pick(AGENTS), amount_nano_ptra: randBig(30) });
    } else if (roll < 0.75) {
      events.push({ event_type: "oracle.feed_submitted", symbol: pick(SYMBOLS), value: randBig(40) });
    } else if (roll < 0.85) {
      tick += 1n + BigInt(ri(3));
      events.push({ event_type: "tick.advanced", new_tick: tick });
    } else if (roll < 0.92) {
      events.push({ event_type: "ptra.shadow_init", addr: "0:" + randHex(64) });
    } else {
      // invalid event (terminates the fold; all impls must agree on code@index)
      const kind = ri(3);
      if (kind === 0) events.push({ event_type: "cal.signed", cal_hash: "0x" + randHex(64) }); // UNKNOWN_CAL
      else if (kind === 1) events.push({ event_type: "tick.advanced", new_tick: tick }); // BAD_TICK (not > current)
      else events.push({ event_type: "frobnicate_" + ri(9) }); // UNKNOWN_EVENT
      break;
    }
  }

  return { start: genesisFunded(), events };
}

// ---- run ----
mkdirSync(resolve(HERE, "out"), { recursive: true });
const cases = [];
const lines = [];
for (let c = 0; c < N; c++) {
  const cs = genCase();
  const text = serializeCanonical(cs);
  cases.push(text);
  lines.push(Buffer.from(text, "utf8").toString("hex"));
}
const batch = lines.join("\n") + "\n";

function runHarness(h) {
  try {
    const out = execFileSync(h.cmd, h.args, { input: batch, maxBuffer: 1 << 30, encoding: "utf8" });
    return out.split("\n").filter((l) => l.length > 0);
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

const outPath = resolve(HERE, "out", "reducer_divergences.jsonl");
writeFileSync(outPath, "");
for (const d of divergences) appendFileSync(outPath, JSON.stringify(d) + "\n");

// stats on the TS results (coverage signal)
let ok = 0;
const errCodes = {};
for (const line of results.ts) {
  if (line.startsWith("OK")) ok++;
  else {
    const code = line.slice(4).split("@")[0];
    errCodes[code] = (errCodes[code] || 0) + 1;
  }
}

console.log(`seed=${SEED} cases=${N}`);
console.log(`outcomes: ${ok} OK, ${N - ok} ERR  ${JSON.stringify(errCodes)}`);
if (divergences.length === 0) {
  console.log(`✅ 0 divergences — TS / Rust / Go agree on every case.`);
  process.exit(0);
}
console.log(`❌ ${divergences.length} divergence(s). First ${Math.min(SHOW, divergences.length)}:`);
for (const d of divergences.slice(0, SHOW)) {
  console.log(`  case ${d.index}: ts="${d.ts}" rs="${d.rs}" go="${d.go}"`);
  console.log(`    ${Buffer.from(d.case, "utf8").length}B case → ${outPath}`);
}
process.exit(1);
