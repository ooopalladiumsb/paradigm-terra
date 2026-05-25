/**
 * Pricing & escrow (CAL Spec §9.2–§9.3). All amounts are uint256 nano-PTRA.
 */

import { getIn, asBig, type Json } from "./util.js";

export const DEFAULT_GAS_PRICE = 1000n; // nano-PTRA per gas unit (= 1 µPTRA), §9.2 genesis
export const DEFAULT_FLAT_VALIDATION_FEE = 100_000n; // nano-PTRA, §12.6 placeholder
export const GAS_LIMIT_FEE_MULTIPLIER = 100n; // default gas_limit = fee × 100, §9.3

export function gasPrice(state: Json): bigint {
  return asBig(getIn(state, ["governance", "gas_price_nano_ptra_per_unit"]), DEFAULT_GAS_PRICE);
}

/** Convert gas units to nano-PTRA. */
export function toNano(units: bigint, price: bigint): bigint {
  return units * price;
}

export function flatValidationFee(state: Json): bigint {
  return asBig(getIn(state, ["governance", "params", "flat_validation_fee_nano_ptra"]), DEFAULT_FLAT_VALIDATION_FEE);
}

/** Upper bound the agent escrows for dynamic gas (CAL `gas_limit_ptra`, else fee × 100). */
export function maxExpectedDynamicGas(cal: Json, fee: bigint): bigint {
  return asBig(getIn(cal, ["gas_limit_ptra"]), fee * GAS_LIMIT_FEE_MULTIPLIER);
}

/** Total PTRA escrowed at SIGNED→VALIDATED (§9.3). */
export function escrowRequirement(cal: Json, state: Json): bigint {
  const fee = flatValidationFee(state);
  return fee + maxExpectedDynamicGas(cal, fee);
}

export function balanceOf(state: Json, agent: string): bigint {
  return asBig(getIn(state, ["ptra", "balances", agent]), 0n);
}

/** The §9.3 admission gate: the agent must cover the full escrow. */
export function canValidate(cal: Json, state: Json): boolean {
  const agent = getIn(cal, ["agent_id"]);
  if (typeof agent !== "string") return false;
  return balanceOf(state, agent) >= escrowRequirement(cal, state);
}
