/**
 * Per-outcome refund / retention bill (CAL Spec §9.4). Given a terminal outcome
 * and the observed bytes written, compute the nano-PTRA amounts a validator bakes
 * into the events. Pure; conservation against the reducer's fee arithmetic is a
 * validator-phase concern (the reducer is frozen).
 */

import { gasUnits } from "./units.js";
import { flatValidationFee, gasPrice, maxExpectedDynamicGas, toNano } from "./pricing.js";
import { type Json } from "./util.js";

export type Outcome =
  | "FINALIZED"
  | "FAILED_PRECOND" // PRECOND_FALSE / CAPABILITY_DENIED — spam charge, no gas
  | "FAILED_EXEC" // STEP_ERROR / POSTCOND_FALSE / INVARIANT_FALSE / OUT_OF_GAS
  | "EXPIRED_PRE" // expired before VALIDATED — no PTRA touched
  | "EXPIRED_POST"; // expired after VALIDATED — flat fee retained

export interface GasBill {
  readonly feeRetained: bigint;
  readonly dynamicGasConsumed: bigint;
  readonly gasRefunded: bigint;
  readonly totalAgentCharge: bigint;
}

const ZERO: GasBill = { feeRetained: 0n, dynamicGasConsumed: 0n, gasRefunded: 0n, totalAgentCharge: 0n };

function clampSub(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}

/** Compute the gas bill for a terminal CAL outcome (§9.4). */
export function settle(outcome: Outcome, cal: Json, state: Json, bytesWritten: bigint): GasBill {
  const fee = flatValidationFee(state);
  const maxGas = maxExpectedDynamicGas(cal, fee);

  switch (outcome) {
    case "EXPIRED_PRE":
      return ZERO;
    case "FAILED_PRECOND":
    case "EXPIRED_POST":
      return { feeRetained: fee, dynamicGasConsumed: 0n, gasRefunded: maxGas, totalAgentCharge: fee };
    case "FINALIZED":
    case "FAILED_EXEC": {
      // consumed gas, capped at the escrowed budget (overrun ⇒ OUT_OF_GAS path)
      const raw = toNano(gasUnits(cal, bytesWritten), gasPrice(state));
      const consumed = raw > maxGas ? maxGas : raw;
      return {
        feeRetained: fee,
        dynamicGasConsumed: consumed,
        gasRefunded: clampSub(maxGas, consumed),
        totalAgentCharge: fee + consumed,
      };
    }
  }
}
