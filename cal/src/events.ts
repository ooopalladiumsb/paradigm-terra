/**
 * Canonical event / receipt builders (CAL Spec §5).
 *
 * These produce the exact restricted-JCS object shape for the terminal events
 * that serve as receipts. The gas and state-root *values* are supplied by later
 * phases, but the field layout and `RECEIPT_HASH` are frozen here, so adding the
 * reducer/gas phases never perturbs the receipt format. Uints are bigint;
 * bytes32 / address are 0x / canonical strings.
 */

import type { ReasonCode } from "./lifecycle.js";

export interface FinalizedReceipt {
  readonly calHash: string;
  readonly agentId: string;
  readonly nonce: bigint;
  readonly tickFinalized: bigint;
  readonly stateRootBefore: string;
  readonly stateRootAfter: string;
  readonly gasConsumedPtra: bigint;
  readonly tonIngressFeePaid: bigint;
  readonly stepsApplied: bigint;
  readonly invariantsChecked: bigint;
}

/** Build a `cal.finalized` event (the positive receipt, §5.1). */
export function buildFinalized(r: FinalizedReceipt): Record<string, unknown> {
  return {
    event_type: "cal.finalized",
    cal_hash: r.calHash,
    agent_id: r.agentId,
    nonce: r.nonce,
    tick_finalized: r.tickFinalized,
    state_root_before: r.stateRootBefore,
    state_root_after: r.stateRootAfter,
    gas_consumed_ptra: r.gasConsumedPtra,
    ton_ingress_fee_paid: r.tonIngressFeePaid,
    steps_applied: r.stepsApplied,
    invariants_checked: r.invariantsChecked,
  };
}

export interface NegativeReceipt {
  readonly eventType: "cal.failed" | "cal.expired";
  readonly calHash: string;
  readonly agentId: string;
  readonly nonce: bigint;
  readonly tick: bigint;
  readonly reasonCode: ReasonCode;
  readonly reasonDetail: string;
  readonly gasConsumedPtra: bigint;
  readonly tonIngressFeePaid: bigint;
}

/** Build a `cal.failed` / `cal.expired` event (negative receipt, §5.2). */
export function buildNegative(r: NegativeReceipt): Record<string, unknown> {
  const tickKey = r.eventType === "cal.failed" ? "tick_failed" : "tick_expired";
  return {
    event_type: r.eventType,
    cal_hash: r.calHash,
    agent_id: r.agentId,
    nonce: r.nonce,
    [tickKey]: r.tick,
    reason_code: r.reasonCode,
    reason_detail: r.reasonDetail,
    gas_consumed_ptra: r.gasConsumedPtra,
    ton_ingress_fee_paid: r.tonIngressFeePaid,
  };
}
