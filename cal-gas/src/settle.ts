/**
 * Per-outcome refund / retention bill (CAL Spec §9.4). Given a terminal outcome
 * and the observed bytes written, compute the nano-PTRA amounts a validator bakes
 * into the events. Pure; conservation against the reducer's fee arithmetic is a
 * validator-phase concern (the reducer is frozen).
 */

import { gasUnits } from "./units.js";
import { balanceOf, flatValidationFee, gasPrice, maxExpectedDynamicGas, toNano } from "./pricing.js";
import { getIn, type Json } from "./util.js";

export type Outcome =
  | "FINALIZED"
  | "FAILED_PRECOND" // PRECOND_FALSE / CAPABILITY_DENIED — §9.4 spam charge: min(fee, balance)
  | "FAILED_NO_CHARGE" // UNKNOWN_ACTION / NONCE_MISMATCH / PRECOND_ERROR / escrow shortfall — no PTRA (§9.1 ingress-class)
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

/**
 * Compute the gas bill for a terminal CAL outcome (§9.4). `ownerAuth` (PFC2-M4) is the
 * owner-authorization weight from `ownerAuthUnits(k)`; it defaults to 0, so non-owner-gated
 * outcomes and pre-PFC-2 callers price exactly as v1. It only enters the consumed-gas outcomes
 * (FINALIZED / FAILED_EXEC), where the owner verification actually ran.
 */
export function settle(outcome: Outcome, cal: Json, state: Json, bytesWritten: bigint, ownerAuth: bigint = 0n): GasBill {
  const fee = flatValidationFee(state);
  const maxGas = maxExpectedDynamicGas(cal, fee);

  switch (outcome) {
    case "EXPIRED_PRE":
    case "FAILED_NO_CHARGE":
      return ZERO;
    case "FAILED_PRECOND": {
      // §9.4 spam charge for a pre-VALIDATED failure. No escrow was taken (the
      // §9.3 gate runs *after* capability/precond), so the fee is charged
      // directly at the failure event and capped at the agent's balance — the
      // most that can honestly be taken before escrow guarantees the full fee.
      const agent = getIn(cal, ["agent_id"]);
      const balance = typeof agent === "string" ? balanceOf(state, agent) : 0n;
      const spam = balance < fee ? balance : fee;
      return { feeRetained: spam, dynamicGasConsumed: 0n, gasRefunded: 0n, totalAgentCharge: spam };
    }
    case "EXPIRED_POST":
      // post-VALIDATED: the fee was already escrowed at cal.validated; unused gas refunded.
      return { feeRetained: fee, dynamicGasConsumed: 0n, gasRefunded: maxGas, totalAgentCharge: fee };
    case "FINALIZED":
    case "FAILED_EXEC": {
      // consumed gas, capped at the escrowed budget (overrun ⇒ OUT_OF_GAS path)
      const raw = toNano(gasUnits(cal, bytesWritten, ownerAuth), gasPrice(state));
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
