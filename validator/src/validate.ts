/**
 * The CAL validator (CAL Spec §3–§9). A pure function that drives a SIGNED CAL
 * through the §3.1 lifecycle from `(cal, snapshot, trace)`, emitting the
 * self-describing stage events the frozen reducer consumes. It evaluates DSL,
 * checks capability/owner + nonce + expiration, prices gas via cal-gas, and
 * decides the terminal outcome. It does not execute steps — their effects arrive
 * in the trace (§4.1). See ../../docs/notes/cal-validator-design.md.
 */

import {
  isOwnerRequired,
  isRegisteredAction,
  parseEnvelope,
  REQUIRES_SCOPE_TABLE,
  run,
  type Bindings,
  type DslVersion,
  type Outcome as DslOutcome,
  type Scope,
} from "@paradigm-terra/dsl";
import {
  canValidate,
  effectsBytes,
  flatValidationFee,
  gasPrice,
  gasUnits,
  getIn,
  maxExpectedDynamicGas,
  settle,
  toNano,
  type GasBill,
  type Json,
} from "@paradigm-terra/cal-gas";
import type { ExecutionTrace } from "./trace.js";

export type TerminalStage = "FINALIZED" | "FAILED" | "EXPIRED";

/** Failure reasons reachable by the v0.1.0 core pipeline (subset of §3.5). */
export type ReasonCode =
  | "UNKNOWN_ACTION"
  | "NONCE_MISMATCH"
  | "CAPABILITY_DENIED"
  | "PRECOND_FALSE"
  | "PRECOND_ERROR"
  | "STEP_ERROR"
  | "POSTCOND_FALSE"
  | "INVARIANT_FALSE"
  | "INSUFFICIENT_ESCROW" // §9.3 escrow gate: balance < fee + Max_Expected_Dynamic_Gas (pre-VALIDATED)
  | "OUT_OF_GAS"; // §9.3 dynamic-gas overrun at execution (post-VALIDATED)

export type Event = Record<string, Json>;

export interface ValidationResult {
  /** Ordered, reducer-ready stage events (§7.1 self-describing). */
  readonly events: readonly Event[];
  readonly terminalStage: TerminalStage;
  /** Non-null only for FAILED. */
  readonly reasonCode: ReasonCode | null;
  /** Human-facing detail; NOT consensus-critical (not pinned by goldens). */
  readonly reasonDetail: string;
  /** Intended §9.4 settlement (the reducer realizes a subset; see design §6). */
  readonly bill: GasBill;
}

function asStr(v: Json | undefined): string {
  return typeof v === "string" ? v : "";
}
function asBig(v: Json | undefined): bigint {
  return typeof v === "bigint" ? v : 0n;
}

/** Evaluate an embedded expression; a `{dsl_version, expr}` envelope overrides v1.2. */
function evalExpr(node: Json | undefined, scope: Scope, bindings: Bindings): DslOutcome {
  let version: DslVersion = "1.2";
  let expr: unknown = node;
  if (typeof node === "object" && node !== null && !Array.isArray(node) && "dsl_version" in node) {
    const env = parseEnvelope(node);
    version = env.version;
    expr = env.expr;
  }
  return run(expr, { scope, version, bindings });
}

/** v0.1.0 capability grant: agent's `granted_scopes` covers the action's required scopes. */
function capabilityGrants(snapshot: Json, agent: string, action: string): boolean {
  const required = REQUIRES_SCOPE_TABLE[action] ?? [];
  if (required.length === 0) return true;
  const granted = getIn(snapshot, ["registry", "agents", agent, "granted_scopes"]);
  const set = new Set<string>();
  if (Array.isArray(granted)) for (const x of granted) if (typeof x === "string") set.add(x);
  return required.every((s) => set.has(s));
}

/**
 * Validate a SIGNED CAL against the snapshot and execution trace, producing the
 * lifecycle events and terminal outcome. `calHashHex` is the CAL_HASH computed
 * at ingress (opaque here; echoed into every event's `cal_hash`).
 */
export function validate(cal: Json, calHashHex: string, snapshot: Json, trace: ExecutionTrace): ValidationResult {
  const agent = asStr(getIn(cal, ["agent_id"]));
  const action = asStr(getIn(cal, ["action"]));
  const nonce = asBig(getIn(cal, ["nonce"]));
  const expiration = asBig(getIn(cal, ["expiration_tick"]));
  const tick = trace.currentTick;
  const fee = flatValidationFee(snapshot);

  const events: Event[] = [];
  const idBase = (): Event => ({ cal_hash: calHashHex, agent_id: agent, nonce });
  const result = (stage: TerminalStage, reason: ReasonCode | null, detail: string, bill: GasBill): ValidationResult => ({
    events: [...events],
    terminalStage: stage,
    reasonCode: reason,
    reasonDetail: detail,
    bill,
  });

  // Pre-VALIDATED FAILED that retains the §9.4 spam charge (PRECOND_FALSE,
  // CAPABILITY_DENIED). No cal.validated fires, so the fee was never escrowed:
  // the failure event carries `fee_debited_ptra` and the reducer debits it at
  // cal.failed (Tier-2 revision). The amount is min(fee, balance) — the escrow
  // gate (§9.3) runs *after* these gates, so the full fee is not yet guaranteed.
  // events == bill: the event's fee_debited_ptra IS the bill's feeRetained.
  const spamFail = (reason: ReasonCode, detail: string): ValidationResult => {
    const bill = settle("FAILED_PRECOND", cal, snapshot, 0n);
    events.push({ event_type: "cal.failed", ...idBase(), tick_failed: tick, reason_code: reason, fee_debited_ptra: bill.feeRetained, gas_consumed_ptra: 0n, ton_ingress_fee_paid: 0n });
    return result("FAILED", reason, detail, bill);
  };

  // Pre-VALIDATED FAILED that moves no PTRA: malformed/replay submissions
  // (UNKNOWN_ACTION, NONCE_MISMATCH), a precondition that errored rather than
  // returned false (PRECOND_ERROR), or an agent that cannot even cover the
  // escrow (§9.3). §9.4 charges only PRECOND_FALSE / CAPABILITY_DENIED; these
  // are §9.1 ingress-class (TON ingress fee only). fee_debited_ptra = 0.
  const noChargeFail = (reason: ReasonCode, detail: string): ValidationResult => {
    const bill = settle("FAILED_NO_CHARGE", cal, snapshot, 0n);
    events.push({ event_type: "cal.failed", ...idBase(), tick_failed: tick, reason_code: reason, fee_debited_ptra: 0n, gas_consumed_ptra: 0n, ton_ingress_fee_paid: 0n });
    return result("FAILED", reason, detail, bill);
  };

  // 1. action registered (§2.3)
  if (!isRegisteredAction(action)) return noChargeFail("UNKNOWN_ACTION", `action ${JSON.stringify(action)} not in §2.3 registry`);

  // 2. expiration before VALIDATED (§3.4) — no PTRA touched
  if (tick > expiration) {
    const bill = settle("EXPIRED_PRE", cal, snapshot, 0n);
    events.push({ event_type: "cal.expired", ...idBase(), tick_expired: tick, gas_consumed_ptra: 0n, ton_ingress_fee_paid: 0n });
    return result("EXPIRED", null, `expired before VALIDATED: tick ${tick} > expiration ${expiration}`, bill);
  }

  // 3. nonce monotonicity (§6.2)
  const expectedNonce = asBig(getIn(snapshot, ["cal", "nonces", agent])) + 1n;
  if (nonce !== expectedNonce) return noChargeFail("NONCE_MISMATCH", `nonce ${nonce} != ${expectedNonce}`);

  // 4. owner co-signature for OWNER_REQUIRED_ACTIONS (§8.2) — §9.4 spam charge
  if (isOwnerRequired(action) && !trace.ownerSigPresent) return spamFail("CAPABILITY_DENIED", `owner_sig required for ${action}`);

  // 5. scope grant (§4.3) — §9.4 spam charge
  if (!capabilityGrants(snapshot, agent, action)) return spamFail("CAPABILITY_DENIED", `agent lacks required scope for ${action}`);

  // 6. preconditions over the snapshot — PRECOND_FALSE retains the §9.4 fee;
  //    PRECOND_ERROR (a malformed/erroring expression) is ingress-class, no charge.
  const pre = evalExpr(getIn(cal, ["preconditions"]), "precondition", { state: snapshot });
  if (pre.code !== "EVALUATION_TRUE") {
    const detail = `preconditions ${pre.code}${pre.reason ? `/${pre.reason}` : ""}`;
    return pre.code === "EVALUATION_FALSE" ? spamFail("PRECOND_FALSE", detail) : noChargeFail("PRECOND_ERROR", detail);
  }

  // 7. §9.3 escrow gate: balance ≥ Flat_Validation_Fee + Max_Expected_Dynamic_Gas.
  //    The agent cannot cover escrow, so no PTRA can be taken (no charge). Distinct
  //    from the post-VALIDATED OUT_OF_GAS overrun (gate 11): this is the admission
  //    shortfall, §3.5 reason code INSUFFICIENT_ESCROW.
  if (!canValidate(cal, snapshot)) return noChargeFail("INSUFFICIENT_ESCROW", `balance < escrow (§9.3)`);

  // --- cal.validated: §9.3 upfront deposit — the agent escrows fee + Max_Expected_
  // Dynamic_Gas. The reducer debits the full escrow; the unused gas is refunded at
  // the terminal event (gas_refunded_ptra), and the treasury keeps escrow − refund.
  const maxGas = maxExpectedDynamicGas(cal, fee);
  events.push({ event_type: "cal.validated", ...idBase(), escrow_ptra: fee + maxGas });

  const expirePost = (): ValidationResult => {
    const bill = settle("EXPIRED_POST", cal, snapshot, 0n);
    events.push({ event_type: "cal.expired", ...idBase(), tick_expired: tick, gas_consumed_ptra: 0n, gas_refunded_ptra: bill.gasRefunded, ton_ingress_fee_paid: 0n });
    return result("EXPIRED", null, `expired after VALIDATED: tick ${tick} > expiration ${expiration}`, bill);
  };
  const execFail = (reason: ReasonCode, detail: string, committed: Json[]): ValidationResult => {
    const bill = settle("FAILED_EXEC", cal, snapshot, effectsBytes(committed));
    events.push({ event_type: "cal.failed", ...idBase(), tick_failed: tick, reason_code: reason, gas_consumed_ptra: bill.dynamicGasConsumed, gas_refunded_ptra: bill.gasRefunded, ton_ingress_fee_paid: 0n });
    return result("FAILED", reason, detail, bill);
  };

  // 8. re-check expiration (defensive; fires only under multi-tick orchestration)
  if (tick > expiration) return expirePost();

  // 9–10. steps: each must succeed and satisfy its post_conditions
  const stepsNode = getIn(cal, ["steps"]);
  const steps = Array.isArray(stepsNode) ? stepsNode : [];
  const committed: Json[] = [];
  for (let i = 0; i < steps.length; i++) {
    const tr = trace.steps[i];
    if (!tr || !tr.ok) return execFail("STEP_ERROR", tr?.errorDetail ?? `step ${i} failed`, committed);
    for (const eff of tr.effects) committed.push(eff);
    const pcs = getIn(steps[i], ["post_conditions"]);
    if (Array.isArray(pcs)) {
      const params = getIn(steps[i], ["params"]);
      for (const pc of pcs) {
        const o = evalExpr(pc, "post_condition", { before: trace.stateBefore, after: trace.stateAfter, params });
        if (o.code !== "EVALUATION_TRUE") {
          const reason: ReasonCode = o.code === "EVALUATION_FALSE" ? "POSTCOND_FALSE" : "STEP_ERROR";
          return execFail(reason, `step ${i} post_condition ${o.code}${o.reason ? `/${o.reason}` : ""}`, committed);
        }
      }
    }
  }

  // 11. dynamic gas vs escrowed budget (§9.3) → OUT_OF_GAS on overrun
  const bytesWritten = effectsBytes(committed);
  const rawGas = toNano(gasUnits(cal, bytesWritten), gasPrice(snapshot));
  if (rawGas > maxGas) return execFail("OUT_OF_GAS", `dynamic gas ${rawGas} > budget ${maxGas}`, committed);
  const consumed = rawGas;

  // --- cal.executed: effects staged, gas recorded ---
  events.push({ event_type: "cal.executed", ...idBase(), effects: committed, gas_consumed_ptra: consumed });

  // 12. re-check expiration (defensive)
  if (tick > expiration) return expirePost();

  // 13. invariants over state.before / state.after
  const invNode = getIn(cal, ["invariants"]);
  const invariants = Array.isArray(invNode) ? invNode : [];
  for (let i = 0; i < invariants.length; i++) {
    const o = evalExpr(invariants[i], "invariant", { before: trace.stateBefore, after: trace.stateAfter });
    if (o.code !== "EVALUATION_TRUE") {
      return execFail("INVARIANT_FALSE", `invariant ${i} ${o.code}${o.reason ? `/${o.reason}` : ""}`, committed);
    }
  }

  // --- cal.settled + cal.finalized: refund unused gas ---
  events.push({ event_type: "cal.settled", cal_hash: calHashHex });
  const bill = settle("FINALIZED", cal, snapshot, bytesWritten);
  events.push({
    event_type: "cal.finalized",
    ...idBase(),
    tick_finalized: tick,
    gas_consumed_ptra: consumed,
    gas_refunded_ptra: bill.gasRefunded,
    steps_applied: BigInt(steps.length),
    invariants_checked: BigInt(invariants.length),
  });
  return result("FINALIZED", null, "", bill);
}
