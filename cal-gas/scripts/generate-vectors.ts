/**
 * Generate golden vectors for @paradigm-terra/cal-gas v0.1.0.
 *
 * Pins, for sample (CAL, state, bytesWritten): static + total gas units, gas
 * price, flat fee, max-expected gas, escrow, the §9.3 admission gate, and the
 * full §9.4 GasBill for each of the five outcomes. CALs/states are stored as
 * canonical-JSON text; all amounts are decimal strings (uint256). Promote
 * PRE-NORMATIVE → NORMATIVE once cal-gas-rs and cal-gas-go reproduce every value.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical, type JcsValue } from "@paradigm-terra/canonical";
import {
  canValidate,
  escrowRequirement,
  flatValidationFee,
  gasPrice,
  gasUnits,
  maxExpectedDynamicGas,
  settle,
  staticGasUnits,
  toNano,
  type Outcome,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "golden.json");

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const SIG = "0x" + "ab".repeat(64);
const s = (b: bigint) => b.toString();

function calSend(extra: Record<string, JcsValue> = {}): Record<string, JcsValue> {
  return {
    cal_version: "0.1.0",
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 100000000n } },
    invariants: [{ op: "eq", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } }],
    steps: [
      {
        verb: "wallet.send_ton",
        params: { to: A, amount_nano_ton: 50n },
        post_conditions: [{ op: "lt", lhs: { var: "state.after.x" }, rhs: { var: "state.before.x" } }],
      },
    ],
    receipt_required: true,
    signatures: { operator_sig: SIG },
    ...extra,
  };
}

function calMulti(): Record<string, JcsValue> {
  const step = (i: number) => ({
    verb: "treasury.transfer",
    params: { idx: BigInt(i) },
    post_conditions: [{ op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { const: 0n } }],
  });
  return {
    cal_version: "0.1.0",
    action: "treasury.transfer",
    agent_id: A,
    nonce: 2n,
    expiration_tick: 200n,
    preconditions: { op: "and", args: [{ op: "gte", lhs: { var: "state.x" }, rhs: { const: 1n } }, { op: "eq", lhs: { var: "state.y" }, rhs: { const: 0n } }] },
    invariants: [
      { op: "eq", lhs: { var: "state.after.a" }, rhs: { var: "state.before.a" } },
      { op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } },
    ],
    steps: [step(0), step(1)],
    receipt_required: true,
    signatures: { operator_sig: SIG },
  };
}

function stateWith(balance: bigint, params: Record<string, JcsValue> = {}, price = 1000n): Record<string, JcsValue> {
  return {
    cal: { in_flight: {}, nonces: {} },
    failure_mode: { is_bounded_mode: false, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: price, genesis_validator_set: [], params },
    oracles: { feeds: {} },
    ptra: { balances: { [A]: balance } },
    registry: { agents: {}, mcp_schema_hash: "0x" + "00".repeat(32) },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

interface Spec {
  id: string;
  description: string;
  cal: Record<string, JcsValue>;
  state: Record<string, JcsValue>;
  bytes: bigint;
}

const OUTCOMES: Outcome[] = ["FINALIZED", "FAILED_PRECOND", "FAILED_EXEC", "EXPIRED_PRE", "EXPIRED_POST"];

const specs: Spec[] = [
  { id: "send_ton_default", description: "wallet.send_ton, default governance, 80 bytes written", cal: calSend(), state: stateWith(10n ** 18n), bytes: 80n },
  { id: "explicit_gas_limit", description: "CAL declares gas_limit_ptra = 5_000_000", cal: calSend({ gas_limit_ptra: 5_000_000n }), state: stateWith(10n ** 18n), bytes: 80n },
  { id: "custom_params", description: "flat fee 250k, gas price 2000, 120 bytes", cal: calSend(), state: stateWith(10n ** 18n, { flat_validation_fee_nano_ptra: 250_000n }, 2000n), bytes: 120n },
  { id: "multi_step", description: "treasury.transfer, 2 steps + 2 invariants, 200 bytes", cal: calMulti(), state: stateWith(10n ** 18n), bytes: 200n },
  { id: "underfunded", description: "balance below escrow → canValidate false", cal: calSend(), state: stateWith(50n), bytes: 80n },
];

const vectors = specs.map((spec) => {
  const fee = flatValidationFee(spec.state);
  const bills: Record<string, Record<string, string>> = {};
  for (const o of OUTCOMES) {
    const b = settle(o, spec.cal, spec.state, spec.bytes);
    bills[o] = { feeRetained: s(b.feeRetained), dynamicGasConsumed: s(b.dynamicGasConsumed), gasRefunded: s(b.gasRefunded), totalAgentCharge: s(b.totalAgentCharge) };
  }
  return {
    id: spec.id,
    description: spec.description,
    cal_canonical: serializeCanonical(spec.cal as JcsValue),
    state_canonical: serializeCanonical(spec.state as JcsValue),
    bytes_written: s(spec.bytes),
    output: {
      static_gas_units: s(staticGasUnits(spec.cal)),
      gas_units: s(gasUnits(spec.cal, spec.bytes)),
      gas_price: s(gasPrice(spec.state)),
      flat_fee: s(fee),
      max_expected_gas: s(maxExpectedDynamicGas(spec.cal, fee)),
      escrow: s(escrowRequirement(spec.cal, spec.state)),
      can_validate: canValidate(spec.cal, spec.state),
      bills,
    },
  };
});

const doc = {
  meta: {
    package: "@paradigm-terra/cal-gas",
    version: "0.1.0",
    spec_basis: "CAL Execution Specification v0.1.0-draft §9 — gas units (§9.2), escrow (§9.3), per-outcome bill (§9.4)",
    generated_at: new Date().toISOString(),
    status:
      "NORMATIVE — generated by the TypeScript reference implementation and verified byte-for-byte by the Rust (cal-gas-rs) and Go (cal-gas-go) parity implementations on 2026-05-25 (every gas unit + amount, the §9.3 admission gate, and the full §9.4 bill for all five outcomes; 135 checks each).",
  },
  vectors,
};

await writeFile(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`Wrote ${vectors.length} gas vectors to ${OUTPUT_PATH}`);
