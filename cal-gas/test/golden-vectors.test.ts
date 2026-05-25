/**
 * Golden-vector verification for the gas layer. Recomputes every value from the
 * stored CAL + state and asserts a match. The Rust/Go ports must reproduce this.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseCanonical } from "@paradigm-terra/canonical";
import {
  canValidate,
  escrowRequirement,
  flatValidationFee,
  gasPrice,
  gasUnits,
  maxExpectedDynamicGas,
  settle,
  staticGasUnits,
  type Json,
  type Outcome,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(__dirname, "..", "vectors", "golden.json"), "utf8"));
const OUTCOMES: Outcome[] = ["FINALIZED", "FAILED_PRECOND", "FAILED_EXEC", "EXPIRED_PRE", "EXPIRED_POST"];

test("golden gas vectors reproduce every unit, amount, and bill", () => {
  assert.ok(golden.vectors.length >= 5);
  for (const v of golden.vectors) {
    const cal = parseCanonical(v.cal_canonical) as Json;
    const state = parseCanonical(v.state_canonical) as Json;
    const bytes = BigInt(v.bytes_written);
    const fee = flatValidationFee(state);
    const o = v.output;

    assert.equal(staticGasUnits(cal).toString(), o.static_gas_units, `${v.id}: static`);
    assert.equal(gasUnits(cal, bytes).toString(), o.gas_units, `${v.id}: total`);
    assert.equal(gasPrice(state).toString(), o.gas_price, `${v.id}: price`);
    assert.equal(fee.toString(), o.flat_fee, `${v.id}: fee`);
    assert.equal(maxExpectedDynamicGas(cal, fee).toString(), o.max_expected_gas, `${v.id}: maxGas`);
    assert.equal(escrowRequirement(cal, state).toString(), o.escrow, `${v.id}: escrow`);
    assert.equal(canValidate(cal, state), o.can_validate, `${v.id}: canValidate`);

    for (const oc of OUTCOMES) {
      const b = settle(oc, cal, state, bytes);
      const w = o.bills[oc];
      assert.equal(b.feeRetained.toString(), w.feeRetained, `${v.id}/${oc}: feeRetained`);
      assert.equal(b.dynamicGasConsumed.toString(), w.dynamicGasConsumed, `${v.id}/${oc}: consumed`);
      assert.equal(b.gasRefunded.toString(), w.gasRefunded, `${v.id}/${oc}: refunded`);
      assert.equal(b.totalAgentCharge.toString(), w.totalAgentCharge, `${v.id}/${oc}: charge`);
    }
  }
});
