/**
 * The CAL validator (CAL Spec §3–§9). A pure function that drives a SIGNED CAL
 * through the §3.1 lifecycle from `(cal, snapshot, trace)`, emitting the
 * self-describing stage events the frozen reducer consumes. It evaluates DSL,
 * checks capability/owner + nonce + expiration, prices gas via cal-gas, and
 * decides the terminal outcome. It does not execute steps — their effects arrive
 * in the trace (§4.1). See ../../docs/notes/cal-validator-design.md.
 */

import {
  effectiveInvariants,
  expandGrantedScopes,
  isBoundedAllowed,
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
  | "BOUNDED_BLOCKED" // §10.2 action not in Bounded-Mode whitelist
  | "SCHEMA_MISMATCH" // §4.4 validator's pinned MCP schema hash ≠ state.registry.mcp_schema_hash
  | "INSUFFICIENT_ESCROW" // §9.3 escrow gate: balance < fee + Max_Expected_Dynamic_Gas (pre-VALIDATED)
  | "OUT_OF_GAS" // §9.3 dynamic-gas overrun at execution (post-VALIDATED)
  | "QUORUM_NOT_MET" // PFC2-M1 §5: multisig owner-signature set well-formed but < threshold
  | "INVALID_SIGNATURE_SET"; // PFC2-M1 §5: multisig owner_sigs[] malformed (unsorted/duplicate/non-owner/cardinality)

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

/**
 * v0.1.0 capability grant (Annex A): the agent's `granted_scopes`, expanded by
 * tier implication (treasury_access:transfer ⇒ :view, governance_scope:vote ⇒
 * :propose), MUST cover every scope the action requires.
 */
function capabilityGrants(snapshot: Json, agent: string, action: string): boolean {
  const required = REQUIRES_SCOPE_TABLE[action] ?? [];
  if (required.length === 0) return true;
  const granted = getIn(snapshot, ["registry", "agents", agent, "granted_scopes"]);
  const raw: string[] = [];
  if (Array.isArray(granted)) for (const x of granted) if (typeof x === "string") raw.push(x);
  const set = expandGrantedScopes(raw);
  return required.every((s) => set.has(s));
}

/**
 * PFC2-M1 §1.1/§2: the multisig owner-authorization gate. Active when the agent's registry
 * record carries an `owners[]` array (a v2 AuthorizationSet); a v1 `owner_pubkey` record is
 * handled by the legacy single-owner branch (migration is PFC2-M3). Pure over the snapshot and
 * `trace.ownerSigners` (the node's per-envelope owner-match verdicts, in presented order).
 *
 * The registry `owners`/`threshold` are assumed well-formed (sorted, distinct, 1 ≤ threshold ≤
 * len ≤ MAX_OWNERS) — those bounds are reducer-enforced (PFC2-M3), NOT re-checked here (M1 §1.1).
 * This gate validates the PRESENTED signature set and the quorum count only.
 *
 * Returns a `{code, detail}` failure (caller wraps with the §9.4 spam charge) or `null` to pass.
 */
function multisigQuorum(
  owners: readonly string[],
  threshold: bigint,
  signers: readonly string[],
): { code: ReasonCode; detail: string } | null {
  // §2 structural checks over the presented set → INVALID_SIGNATURE_SET (before quorum).
  if (signers.length > owners.length) {
    return { code: "INVALID_SIGNATURE_SET", detail: `cardinality ${signers.length} > owners ${owners.length}` };
  }
  const ownerSet = new Set(owners);
  for (const s of signers) {
    if (s === "" || !ownerSet.has(s)) return { code: "INVALID_SIGNATURE_SET", detail: "non-owner signer" };
  }
  for (let i = 1; i < signers.length; i++) {
    if (signers[i]! === signers[i - 1]!) return { code: "INVALID_SIGNATURE_SET", detail: "duplicate signer" };
    if (signers[i]! < signers[i - 1]!) return { code: "INVALID_SIGNATURE_SET", detail: "owner_sigs not sorted by matched pubkey" };
  }
  // §2 quorum check over the (now well-formed, distinct) verified set.
  if (BigInt(signers.length) < threshold) {
    return { code: "QUORUM_NOT_MET", detail: `got ${signers.length}/${threshold} owner signatures` };
  }
  return null;
}

/**
 * Factory holding the parsed CAL context, the shared event buffer, and the two
 * lifecycle phases. `phaseA` runs the pre-VALIDATED gates (§ 1–7) and emits
 * `cal.validated`; `phaseB` runs the post-VALIDATED gates (§ 8–13) to a terminal
 * event. They push to a SHARED `events` array so the atomic `validate()` composes
 * them byte-identically to the pre-staging monolith.
 */
function makeValidator(cal: Json, calHashHex: string, snapshot: Json, trace: ExecutionTrace) {
  const agent = asStr(getIn(cal, ["agent_id"]));
  const action = asStr(getIn(cal, ["action"]));
  const nonce = asBig(getIn(cal, ["nonce"]));
  const expiration = asBig(getIn(cal, ["expiration_tick"]));
  const tick = trace.currentTick;
  const fee = flatValidationFee(snapshot);
  const boundedMode = getIn(snapshot, ["failure_mode", "is_bounded_mode"]) === true;
  const maxGas = maxExpectedDynamicGas(cal, fee);

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
  // the failure event carries fee_debited_ptra and the reducer debits it at cal.failed.
  const spamFail = (reason: ReasonCode, detail: string): ValidationResult => {
    const bill = settle("FAILED_PRECOND", cal, snapshot, 0n);
    events.push({ event_type: "cal.failed", ...idBase(), tick_failed: tick, reason_code: reason, fee_debited_ptra: bill.feeRetained, gas_consumed_ptra: 0n, ton_ingress_fee_paid: 0n });
    return result("FAILED", reason, detail, bill);
  };
  // Pre-VALIDATED FAILED that moves no PTRA (UNKNOWN_ACTION, NONCE_MISMATCH,
  // PRECOND_ERROR, INSUFFICIENT_ESCROW): §9.1 ingress-class, fee_debited_ptra = 0.
  const noChargeFail = (reason: ReasonCode, detail: string): ValidationResult => {
    const bill = settle("FAILED_NO_CHARGE", cal, snapshot, 0n);
    events.push({ event_type: "cal.failed", ...idBase(), tick_failed: tick, reason_code: reason, fee_debited_ptra: 0n, gas_consumed_ptra: 0n, ton_ingress_fee_paid: 0n });
    return result("FAILED", reason, detail, bill);
  };
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

  // Phase A — pre-VALIDATED gates (§1–7), then emit cal.validated.
  // Returns a terminal ValidationResult on failure, or null on reaching VALIDATED.
  const phaseA = (): ValidationResult | null => {
    // 1. action registered (§2.3)
    if (!isRegisteredAction(action)) return noChargeFail("UNKNOWN_ACTION", `action ${JSON.stringify(action)} not in §2.3 registry`);

    // 1.25. §4.4 MCP schema-hash pin (no-charge on mismatch).
    const pinned = trace.pinnedMcpSchemaHash ?? "";
    if (pinned !== "") {
      const stateSchema = asStr(getIn(snapshot, ["registry", "mcp_schema_hash"]));
      if (stateSchema !== pinned) return noChargeFail("SCHEMA_MISMATCH", `pinned mcp_schema_hash ${pinned} != state ${stateSchema}`);
    }

    // 1.5. §10.2 Bounded-Mode admission gate (no-charge).
    if (boundedMode && !isBoundedAllowed(action)) return noChargeFail("BOUNDED_BLOCKED", `action ${action} not in §10.2 Bounded-Mode whitelist`);

    // 2. expiration before VALIDATED (§3.4) — no PTRA touched
    if (tick > expiration) {
      const bill = settle("EXPIRED_PRE", cal, snapshot, 0n);
      events.push({ event_type: "cal.expired", ...idBase(), tick_expired: tick, gas_consumed_ptra: 0n, ton_ingress_fee_paid: 0n });
      return result("EXPIRED", null, `expired before VALIDATED: tick ${tick} > expiration ${expiration}`, bill);
    }

    // 3. nonce monotonicity (§6.2)
    const expectedNonce = asBig(getIn(snapshot, ["cal", "nonces", agent])) + 1n;
    if (nonce !== expectedNonce) return noChargeFail("NONCE_MISMATCH", `nonce ${nonce} != ${expectedNonce}`);

    // 4. signature presence + pubkey availability (§8.1 two key tiers, §8.2). The
    //    trace's *SigPresent flags carry the node's verifier verdict (real Ed25519
    //    lands upstream in owner-sig.ts / verifyIngress; validate() is pure over them).
    if (!trace.operatorSigPresent) return spamFail("CAPABILITY_DENIED", `operator_sig required for ${action}`);
    if (asStr(getIn(snapshot, ["registry", "agents", agent, "operator_pubkey"])) === "") {
      return spamFail("CAPABILITY_DENIED", `agent ${agent} has no operator_pubkey in registry`);
    }
    const ownerRequired = isOwnerRequired(action) || boundedMode;
    if (ownerRequired) {
      const ownersNode = getIn(snapshot, ["registry", "agents", agent, "owners"]);
      if (Array.isArray(ownersNode)) {
        // PFC2-M1 §2: multi-owner (AuthorizationSet v2) quorum gate.
        const owners = ownersNode.filter((x): x is string => typeof x === "string");
        if (owners.length === 0) return spamFail("CAPABILITY_DENIED", `agent ${agent} has no owners in registry`);
        const threshold = asBig(getIn(snapshot, ["registry", "agents", agent, "threshold"]));
        const signers = Array.isArray(trace.ownerSigners)
          ? trace.ownerSigners.filter((x): x is string => typeof x === "string")
          : [];
        const fail = multisigQuorum(owners, threshold, signers);
        if (fail) return spamFail(fail.code, `${fail.detail} for ${action}`);
      } else {
        // v1 single-owner envelope (legacy; migration to owners[] is PFC2-M3).
        if (!trace.ownerSigPresent) return spamFail("CAPABILITY_DENIED", `owner_sig required for ${action}`);
        if (asStr(getIn(snapshot, ["registry", "agents", agent, "owner_pubkey"])) === "") {
          return spamFail("CAPABILITY_DENIED", `agent ${agent} has no owner_pubkey in registry`);
        }
      }
    }

    // 5. scope grant (§4.3) — §9.4 spam charge
    if (!capabilityGrants(snapshot, agent, action)) return spamFail("CAPABILITY_DENIED", `agent lacks required scope for ${action}`);

    // 6. preconditions over the snapshot
    const pre = evalExpr(getIn(cal, ["preconditions"]), "precondition", { state: snapshot });
    if (pre.code !== "EVALUATION_TRUE") {
      const detail = `preconditions ${pre.code}${pre.reason ? `/${pre.reason}` : ""}`;
      return pre.code === "EVALUATION_FALSE" ? spamFail("PRECOND_FALSE", detail) : noChargeFail("PRECOND_ERROR", detail);
    }

    // 7. §9.3 escrow gate
    if (!canValidate(cal, snapshot)) return noChargeFail("INSUFFICIENT_ESCROW", `balance < escrow (§9.3)`);

    // --- cal.validated: §9.3 upfront deposit (escrow = fee + Max_Expected_Dynamic_Gas).
    events.push({ event_type: "cal.validated", ...idBase(), escrow_ptra: fee + maxGas });
    return null;
  };

  // Phase B — post-VALIDATED gates (§8–13) → terminal. Assumes VALIDATED reached.
  // EXPIRED_POST fires when tick > expiration (only under multi-tick orchestration).
  const phaseB = (): ValidationResult => {
    // 8. re-check expiration
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

    // 13. invariants over state.before / state.after (Bounded Mode appends the emergency set)
    const invNode = getIn(cal, ["invariants"]);
    const declared = Array.isArray(invNode) ? invNode : [];
    const invariants = effectiveInvariants(declared as readonly unknown[], boundedMode) as Json[];
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
  };

  return { events, phaseA, phaseB };
}

/**
 * Validate a SIGNED CAL against the snapshot and execution trace, producing the
 * lifecycle events and terminal outcome. `calHashHex` is the CAL_HASH computed
 * at ingress (opaque here; echoed into every event's `cal_hash`).
 *
 * Atomic composition of {@link validateToValidated} + {@link resumeFromValidated}
 * (Gate #3): the orchestrator uses the staged pair to split a CAL's lifecycle
 * across ticks, making EXPIRED_POST (resume at tick > expiration) and AGENT_BUSY
 * (a CAL left in-flight at VALIDATED) reachable. This atomic path is byte-identical
 * to the pre-staging behavior.
 */
export function validate(cal: Json, calHashHex: string, snapshot: Json, trace: ExecutionTrace): ValidationResult {
  const v = makeValidator(cal, calHashHex, snapshot, trace);
  const a = v.phaseA();
  if (a) return a;
  return v.phaseB();
}

/** Stage-1 result for staged (multi-tick) orchestration. */
export interface ToValidatedResult {
  /** Non-null on pre-validation failure (terminal); null on reaching VALIDATED. */
  readonly terminal: ValidationResult | null;
  /** Events to fold: the failure event when terminal, else `[cal.validated]`. */
  readonly events: readonly Event[];
}

/**
 * Stage 1 (§ gates 1–7 → `cal.validated`). On success, leaves the CAL in-flight at
 * VALIDATED (events = `[cal.validated]`, `terminal` null). On a pre-validation
 * failure, `terminal` is the terminal result and `events` its failure event.
 */
export function validateToValidated(cal: Json, calHashHex: string, snapshot: Json, trace: ExecutionTrace): ToValidatedResult {
  const v = makeValidator(cal, calHashHex, snapshot, trace);
  const a = v.phaseA();
  if (a) return { terminal: a, events: a.events };
  return { terminal: null, events: [...v.events] };
}

/**
 * Stage 2 (§ gates 8–13). Resumes a VALIDATED CAL to a terminal event. Run against
 * the post-`cal.validated` snapshot at the resume tick; EXPIRED_POST fires when
 * `trace.currentTick > expiration_tick`. Emits only the post-VALIDATED events.
 */
export function resumeFromValidated(cal: Json, calHashHex: string, snapshot: Json, trace: ExecutionTrace): ValidationResult {
  const v = makeValidator(cal, calHashHex, snapshot, trace);
  return v.phaseB();
}
