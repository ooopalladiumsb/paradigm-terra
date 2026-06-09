// M2-B · SC-2 — the off-chain settlement reconciler (classifier).
//
// Pure, OFFLINE function: given a CAL's expected settlement (the authorized wallet.send_ton action +
// its settlement window) and the observed on-chain settlement (or none), classify the outcome into the
// four reconciliation classes. The result is exactly the `status` the M2-A record stores — so a
// classified entry feeds buildRecordCell / buildUpsertBody directly.
//
// This is OBSERVATION, not consensus: the reconciler reads expected-vs-observed and labels; it never
// validates, re-executes, or re-derives a CAL. No network here — observations arrive as data (real
// chain reads in M2-C, simulated fixtures in the SC-2 tests). Scope stays wallet.send_ton only.
import { SettlementStatus } from "./record.ts";

/** What the CAL authorized + the window we expect it to settle within (derived off-chain, send_ton). */
export type ExpectedSettlement = {
  externalMessageHash: bigint;
  calHash: bigint;
  nonce: bigint;
  /** authorized destination (raw address hash, uint256) */
  dest: bigint;
  /** authorized value in nanotons */
  value: bigint;
  /** unixtime by which a faithful settlement is expected; later ⇒ Delayed, absent past it ⇒ Missing */
  deadlineUnix: number;
};

/** A settling transaction observed for this external message (null ⇒ none observed yet). */
export type ObservedSettlement = {
  txHash: bigint;
  /** the on-chain effect's actual destination (uint256) */
  effectDest: bigint;
  /** the on-chain effect's actual value in nanotons */
  effectValue: bigint;
  /** unixtime the settling transaction was observed */
  observedAtUnix: number;
};

export type Reconciliation = {
  status: SettlementStatus;
  /** terminal ⇔ status is one of the four stored classes (1..4); Unknown (0) means not-yet-decidable */
  terminal: boolean;
  reason: string;
};

/**
 * Classify one settlement. Decision order (effect fidelity dominates timing):
 *   observed?
 *     no  → past deadline ? MISSING : UNKNOWN (pending, not yet terminal)
 *     yes → effect != authorized ? MISMATCH
 *           : within window      ? SETTLED
 *           : (late)              DELAYED
 * `nowUnix` is the reconciliation clock (the fixture's "now" offline; wall-clock in M2-C).
 */
export function classify(
  expected: ExpectedSettlement,
  observed: ObservedSettlement | null,
  nowUnix: number,
): Reconciliation {
  if (observed === null) {
    if (nowUnix > expected.deadlineUnix) {
      return { status: SettlementStatus.Missing, terminal: true, reason: "no settling tx observed past the deadline" };
    }
    return { status: SettlementStatus.Unknown, terminal: false, reason: "not yet observed, window still open" };
  }

  // Effect fidelity first: any deviation from the authorized dest+value is a mismatch (incl. widening).
  if (observed.effectDest !== expected.dest || observed.effectValue !== expected.value) {
    const how =
      observed.effectDest !== expected.dest
        ? "destination"
        : observed.effectValue > expected.value
          ? "value widened"
          : "value shortened";
    return { status: SettlementStatus.Mismatch, terminal: true, reason: `observed effect != authorized action (${how})` };
  }

  if (observed.observedAtUnix <= expected.deadlineUnix) {
    return { status: SettlementStatus.Settled, terminal: true, reason: "faithful effect within the window" };
  }
  return { status: SettlementStatus.Delayed, terminal: true, reason: "faithful effect, but observed past the deadline" };
}
