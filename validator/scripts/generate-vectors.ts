/**
 * Generate golden vectors for @paradigm-terra/cal-validator v0.1.0.
 *
 * Pins, for each (cal, snapshot, execution-trace): the ordered emitted
 * `event_type` sequence, the terminal stage, the `reason_code` (or null), the
 * economic event fields (escrow / terminal_fee_debited / gas_consumed /
 * gas_refunded), and the full §9.4 `bill`. `reason_detail` is human-facing, lives
 * only on the returned result (never an emitted event field — a node folds events
 * into the CE §6.3 Merkle root), and is intentionally NOT pinned. Inputs are stored as
 * canonical-JSON text; all amounts are decimal strings (uint256). Promote
 * PRE-NORMATIVE → NORMATIVE once validator-rs and validator-go reproduce every
 * value byte-for-byte.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical, type JcsValue } from "@paradigm-terra/canonical";
import { validate, type ExecutionTrace, type StepResult } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "golden.json");

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const MISSING = "0:" + "aa".repeat(32); // a valid-shaped address absent from balances
const SIG = "0x" + "ab".repeat(64);
// Ed25519 pubkeys are 32 bytes; values here are placeholders pinned by goldens.
// Real curve verification (deferred) will check the trace's *SigPresent flag was
// produced by the node verifying signatures.* against these exact pubkey bytes.
const OPERATOR_PUBKEY = "0x" + "11".repeat(32);
const OWNER_PUBKEY = "0x" + "22".repeat(32);
// PFC2-M5 (Multisig v2.1): a three-owner set, already ascending (31 < 32 < 33).
const OWNER_K1 = "0x" + "31".repeat(32);
const OWNER_K2 = "0x" + "32".repeat(32);
const OWNER_K3 = "0x" + "33".repeat(32);
const EFFECT: JcsValue = { ns: "ptra", op: "set", path: ["counters", "x"], value: 1n };

type Obj = Record<string, JcsValue>;

function calSend(extra: Obj = {}): Obj {
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

/**
 * §10.2 / §10.4 emergency CAL: oracles.submit_feed (whitelisted, not statically
 * owner-required) shaped to satisfy the three §7.1 injected invariants when the
 * trace's state.after preserves treasury.developer_fund_balance, treasury.nav,
 * and failure_mode.is_bounded_mode = true.
 */
function calOracle(extra: Obj = {}): Obj {
  return {
    cal_version: "0.1.0",
    action: "oracles.submit_feed",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 0n } },
    invariants: [],
    steps: [
      {
        verb: "oracles.submit_feed",
        params: { feed: "ton_usd", value: 1n },
        post_conditions: [],
      },
    ],
    receipt_required: true,
    signatures: { operator_sig: SIG, owner_sig: SIG },
    ...extra,
  };
}

function calTreasury(extra: Obj = {}): Obj {
  return {
    cal_version: "0.1.0",
    action: "treasury.transfer",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 200n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 0n } },
    invariants: [{ op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } }],
    steps: [
      {
        verb: "treasury.transfer",
        params: { amount_nano_ptra: 10n },
        post_conditions: [{ op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { const: 0n } }],
      },
    ],
    receipt_required: true,
    signatures: { operator_sig: SIG, owner_sig: SIG },
    ...extra,
  };
}

function snap(opts: {
  balance?: bigint;
  nonce?: bigint;
  scopes?: string[];
  price?: bigint;
  bounded?: boolean;
  operatorPubkey?: string;
  ownerPubkey?: string;
  owners?: string[]; // PFC2-M5: a v2 multi-owner record (owners[] + threshold) instead of owner_pubkey
  threshold?: bigint;
} = {}): Obj {
  const {
    balance = 10n ** 18n,
    nonce = 0n,
    scopes = ["ton_transfer"],
    price = 1000n,
    bounded = false,
    operatorPubkey = OPERATOR_PUBKEY,
    ownerPubkey = OWNER_PUBKEY,
  } = opts;
  const agent: Obj = { granted_scopes: scopes };
  if (operatorPubkey !== "") agent.operator_pubkey = operatorPubkey;
  if (opts.owners !== undefined) {
    // v2 AuthorizationSet: the owners[]/threshold record (the v1 owner_pubkey is absent).
    agent.owners = [...opts.owners];
    agent.threshold = opts.threshold ?? BigInt(opts.owners.length);
  } else if (ownerPubkey !== "") {
    agent.owner_pubkey = ownerPubkey;
  }
  return {
    cal: { in_flight: {}, nonces: { [A]: nonce } },
    failure_mode: { is_bounded_mode: bounded, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: price, genesis_validator_set: [], params: {} },
    oracles: { feeds: {} },
    ptra: { balances: { [A]: balance } },
    registry: { agents: { [A]: agent }, mcp_schema_hash: "0x" + "00".repeat(32) },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

function step(ok: boolean, effects: JcsValue[] = [EFFECT], errorDetail?: string): StepResult {
  return errorDetail === undefined ? { ok, effects } : { ok, effects, errorDetail };
}

const HAPPY_BEFORE: JcsValue = { x: 5n, treasury: { nav: 0n } };
const HAPPY_AFTER: JcsValue = { x: 1n, treasury: { nav: 0n } };
const TREASURY_BEFORE: JcsValue = { x: 5n, treasury: { nav: 0n } };
const TREASURY_AFTER: JcsValue = { x: 1n, treasury: { nav: 5n } };
// Bounded-mode invariant scope (DSL §7.1): treasury.developer_fund_balance and
// treasury.nav must be non-decreasing, and failure_mode.is_bounded_mode = true.
const BOUNDED_BEFORE: JcsValue = { treasury: { nav: 0n, developer_fund_balance: 100n }, failure_mode: { is_bounded_mode: true } };
const BOUNDED_AFTER_OK: JcsValue = { treasury: { nav: 0n, developer_fund_balance: 100n }, failure_mode: { is_bounded_mode: true } };
const BOUNDED_AFTER_BAD: JcsValue = { treasury: { nav: 0n, developer_fund_balance: 50n }, failure_mode: { is_bounded_mode: true } };

const ZERO_HASH = "0x" + "00".repeat(32);
const ALT_HASH = "0x" + "ab".repeat(32);

function trace(opts: {
  tick?: bigint;
  steps?: StepResult[];
  before?: JcsValue;
  after?: JcsValue;
  owner?: boolean;
  operator?: boolean;
  pinnedMcp?: string;
  ownerSigners?: string[]; // PFC2-M5: node's presented-order owner-match verdicts (v2 multisig)
}): ExecutionTrace {
  return {
    currentTick: opts.tick ?? 0n,
    steps: opts.steps ?? [step(true)],
    stateBefore: opts.before ?? HAPPY_BEFORE,
    stateAfter: opts.after ?? HAPPY_AFTER,
    // §8.1: operator_sig is always required, so default true here. Set false
    // to exercise the missing-operator-sig CAPABILITY_DENIED branch.
    operatorSigPresent: opts.operator ?? true,
    ownerSigPresent: opts.owner ?? false,
    // Validators always pin in production; default to the snapshot's value so
    // the §4.4 gate is exercised in every vector (matched by default).
    pinnedMcpSchemaHash: opts.pinnedMcp ?? ZERO_HASH,
    ...(opts.ownerSigners !== undefined ? { ownerSigners: opts.ownerSigners } : {}),
  };
}

interface Spec {
  id: string;
  description: string;
  cal: Obj;
  snapshot: Obj;
  trace: ExecutionTrace;
}

const specs: Spec[] = [
  { id: "send_finalized", description: "happy wallet.send_ton → FINALIZED", cal: calSend(), snapshot: snap(), trace: trace({}) },
  {
    id: "treasury_finalized",
    description: "treasury.transfer with owner_sig + scope → FINALIZED",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"] }),
    trace: trace({ steps: [step(true)], before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true }),
  },
  { id: "precond_false", description: "balance below precondition threshold → PRECOND_FALSE", cal: calSend(), snapshot: snap({ balance: 50n }), trace: trace({}) },
  {
    id: "precond_error",
    description: "precondition reads an absent address → PRECOND_ERROR (MISSING_VAR)",
    cal: calSend({ preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${MISSING}` }, rhs: { const: 0n } } }),
    snapshot: snap(),
    trace: trace({}),
  },
  { id: "nonce_mismatch", description: "cal.nonce != nonces[agent]+1 → NONCE_MISMATCH", cal: calSend(), snapshot: snap({ nonce: 5n }), trace: trace({}) },
  {
    id: "capability_denied_owner",
    description: "owner-required action without owner_sig → CAPABILITY_DENIED",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"] }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: false }),
  },
  { id: "capability_denied_scope", description: "agent lacks required scope → CAPABILITY_DENIED", cal: calSend(), snapshot: snap({ scopes: [] }), trace: trace({}) },
  { id: "postcond_false", description: "step post_condition evaluates FALSE → POSTCOND_FALSE", cal: calSend(), snapshot: snap(), trace: trace({ before: { x: 1n, treasury: { nav: 0n } }, after: { x: 5n, treasury: { nav: 0n } } }) },
  { id: "invariant_false", description: "invariant over before/after FALSE → INVARIANT_FALSE", cal: calSend(), snapshot: snap(), trace: trace({ before: { x: 5n, treasury: { nav: 0n } }, after: { x: 1n, treasury: { nav: 10n } } }) },
  { id: "step_error", description: "step verb failed → STEP_ERROR", cal: calSend(), snapshot: snap(), trace: trace({ steps: [step(false, [], "mcp call reverted")] }) },
  {
    id: "out_of_gas",
    description: "dynamic gas exceeds gas_limit_ptra budget → OUT_OF_GAS (post-VALIDATED, fee + gas retained)",
    cal: calSend({ gas_limit_ptra: 1000n }),
    snapshot: snap(),
    trace: trace({ steps: [step(true, [])] }),
  },
  {
    id: "insufficient_escrow",
    description: "precond passes but balance < §9.3 escrow → INSUFFICIENT_ESCROW (pre-VALIDATED, no charge)",
    cal: calSend({ preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 0n } } }),
    snapshot: snap({ balance: 50_000n }), // < flat fee (100000) + max gas — cannot escrow
    trace: trace({}),
  },
  { id: "expired_pre", description: "current tick past expiration before VALIDATED → EXPIRED", cal: calSend(), snapshot: snap(), trace: trace({ tick: 200n }) },
  {
    id: "bounded_blocked",
    description: "§10.2 bounded mode, action not in whitelist → BOUNDED_BLOCKED (no charge)",
    cal: calSend(),
    snapshot: snap({ bounded: true }),
    trace: trace({}),
  },
  {
    id: "bounded_sig_escalation",
    description: "§10.4 bounded mode, whitelisted action without owner_sig → CAPABILITY_DENIED (spam-charge)",
    cal: calOracle({ signatures: { operator_sig: SIG } }),
    snapshot: snap({ bounded: true }),
    trace: trace({ before: BOUNDED_BEFORE, after: BOUNDED_AFTER_OK, owner: false }),
  },
  {
    id: "bounded_emergency_invariant_violated",
    description: "§10.3 bounded mode, whitelisted, owner_sig, developer_fund decreased → INVARIANT_FALSE",
    cal: calOracle(),
    snapshot: snap({ bounded: true }),
    trace: trace({ before: BOUNDED_BEFORE, after: BOUNDED_AFTER_BAD, owner: true }),
  },
  {
    id: "bounded_whitelist_pass",
    description: "§10 bounded mode, whitelisted + owner_sig + injected invariants hold → FINALIZED",
    cal: calOracle(),
    snapshot: snap({ bounded: true }),
    trace: trace({ before: BOUNDED_BEFORE, after: BOUNDED_AFTER_OK, owner: true }),
  },
  {
    id: "schema_mismatch",
    description: "§4.4 validator's pinned mcp_schema_hash ≠ state.registry.mcp_schema_hash → SCHEMA_MISMATCH (no charge)",
    cal: calSend(),
    snapshot: snap(),
    trace: trace({ pinnedMcp: ALT_HASH }),
  },
  {
    id: "missing_operator_sig",
    description: "§8.1 operator_sig absent from trace → CAPABILITY_DENIED (§9.4 spam charge)",
    cal: calSend(),
    snapshot: snap(),
    trace: trace({ operator: false }),
  },
  {
    id: "missing_operator_pubkey",
    description: "§8.1 agent has no operator_pubkey in registry → CAPABILITY_DENIED (§9.4 spam charge)",
    cal: calSend(),
    snapshot: snap({ operatorPubkey: "" }),
    trace: trace({}),
  },
  {
    id: "missing_owner_pubkey",
    description: "§8.2 owner-required action, agent has no owner_pubkey in registry → CAPABILITY_DENIED",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], ownerPubkey: "" }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true }),
  },
  {
    id: "governance_scope_denied",
    description: "Annex A governance.vote requires governance_scope:vote; agent has only ton_transfer → CAPABILITY_DENIED",
    cal: calSend({ action: "governance.vote", steps: [{ verb: "governance.vote", params: {}, post_conditions: [] }] }),
    snapshot: snap(),
    trace: trace({}),
  },
  {
    id: "governance_scope_implication_pass",
    description: "Annex A tier implication: granted governance_scope:vote satisfies governance.propose_amendment (requires :propose) → FINALIZED",
    cal: calSend({
      action: "governance.propose_amendment",
      steps: [{ verb: "governance.propose_amendment", params: {}, post_conditions: [] }],
    }),
    snapshot: snap({ scopes: ["governance_scope:vote"] }),
    trace: trace({ owner: true }),
  },

  // PFC2-M5 — Multisig v2.1 (AuthorizationSet v2). Same owner-required treasury.transfer, but the
  // agent carries owners[]/threshold and the trace carries ownerSigners (presented order). The §8.2
  // quorum gate decides FINALIZED / QUORUM_NOT_MET / INVALID_SIGNATURE_SET; M4 gas charges
  // ownerAuthUnits(k). MS-7 is the SC-4 anchor: a migrated 1-of-1 whose OUTPUT is byte-identical to
  // the v1 single-owner `treasury_finalized` vector (asserted in golden-vectors.test.ts).
  {
    id: "ms_quorum_pass",
    description: "MS-1: 2-of-3 quorum met (owners[K1,K2,K3], threshold 2, signers[K1,K2]) → FINALIZED",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_K1, OWNER_K2, OWNER_K3], threshold: 2n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_K1, OWNER_K2] }),
  },
  {
    id: "ms_quorum_not_met",
    description: "MS-2: 1 of a 2-of-3 agent (signers[K1]) → QUORUM_NOT_MET",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_K1, OWNER_K2, OWNER_K3], threshold: 2n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_K1] }),
  },
  {
    id: "ms_invalid_duplicate",
    description: "MS-3: duplicate matched signer (signers[K1,K1]) → INVALID_SIGNATURE_SET",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_K1, OWNER_K2, OWNER_K3], threshold: 2n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_K1, OWNER_K1] }),
  },
  {
    id: "ms_invalid_unsorted",
    description: "MS-4: unsorted signers (signers[K2,K1]) → INVALID_SIGNATURE_SET",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_K1, OWNER_K2, OWNER_K3], threshold: 2n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_K2, OWNER_K1] }),
  },
  {
    id: "ms_invalid_non_owner",
    description: "MS-5: non-owner signer (signers[K1,'']) → INVALID_SIGNATURE_SET",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_K1, OWNER_K2, OWNER_K3], threshold: 2n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_K1, ""] }),
  },
  {
    id: "ms_invalid_cardinality",
    description: "MS-6: more signers than owners (owners[K1,K2] threshold 1, signers[K1,K2,K3]) → INVALID_SIGNATURE_SET",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_K1, OWNER_K2], threshold: 1n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_K1, OWNER_K2, OWNER_K3] }),
  },
  {
    id: "ms_migrated_1of1_equals_v1",
    description: "MS-7 (SC-4): migrated 1-of-1 (owners[OWNER_PUBKEY] threshold 1, signers[OWNER_PUBKEY]) → FINALIZED, OUTPUT byte-identical to treasury_finalized (v1 single-owner)",
    cal: calTreasury(),
    snapshot: snap({ scopes: ["treasury_access:transfer"], owners: [OWNER_PUBKEY], threshold: 1n }),
    trace: trace({ before: TREASURY_BEFORE, after: TREASURY_AFTER, owner: true, ownerSigners: [OWNER_PUBKEY] }),
  },
];

function traceToJcs(t: ExecutionTrace): JcsValue {
  const o: Obj = {
    current_tick: t.currentTick,
    operator_sig_present: t.operatorSigPresent,
    owner_sig_present: t.ownerSigPresent,
    pinned_mcp_schema_hash: t.pinnedMcpSchemaHash ?? "",
    state_before: t.stateBefore,
    state_after: t.stateAfter,
    steps: t.steps.map((s): JcsValue => {
      const so: Obj = { ok: s.ok, effects: [...s.effects] };
      if (s.errorDetail !== undefined) so.error_detail = s.errorDetail;
      return so;
    }),
  };
  // PFC2-M5: present only for v2 multisig vectors, so v1 vectors' trace_canonical is unchanged.
  if (t.ownerSigners !== undefined) o.owner_signers = [...t.ownerSigners];
  return o;
}

const CAL_HASH = (i: number): string => "0x" + (i + 1).toString(16).padStart(2, "0").repeat(32);

function num(events: readonly Record<string, JcsValue>[], type: string, key: string): string | null {
  const e = events.find((ev) => ev["event_type"] === type);
  const v = e?.[key];
  return typeof v === "bigint" ? v.toString() : null;
}

const vectors = specs.map((spec, i) => {
  const calHash = CAL_HASH(i);
  const res = validate(spec.cal as JcsValue, calHash, spec.snapshot as JcsValue, spec.trace);
  const terminal = res.events[res.events.length - 1]!;
  return {
    id: spec.id,
    description: spec.description,
    cal_hash: calHash,
    cal_canonical: serializeCanonical(spec.cal as JcsValue),
    snapshot_canonical: serializeCanonical(spec.snapshot as JcsValue),
    trace_canonical: serializeCanonical(traceToJcs(spec.trace)),
    output: {
      event_types: res.events.map((e) => e["event_type"] as string),
      terminal_stage: res.terminalStage,
      reason_code: res.reasonCode,
      // §9.3 upfront escrow: cal.validated carries escrow_ptra = Flat_Validation_Fee
      // + Max_Expected_Dynamic_Gas; null for vectors that fail/expire pre-VALIDATED.
      escrow_ptra: num(res.events, "cal.validated", "escrow_ptra"),
      // §9.4 Tier-2: the spam charge a pre-VALIDATED cal.failed carries for the
      // reducer to debit (min(fee, balance)); null when the terminal event omits it.
      terminal_fee_debited_ptra: typeof terminal["fee_debited_ptra"] === "bigint" ? (terminal["fee_debited_ptra"] as bigint).toString() : null,
      gas_consumed_ptra: typeof terminal["gas_consumed_ptra"] === "bigint" ? (terminal["gas_consumed_ptra"] as bigint).toString() : null,
      // unused-gas refund the terminal event carries: cal.finalized, a post-VALIDATED
      // cal.failed, or cal.expired-post; null for pre-VALIDATED terminals.
      gas_refunded_ptra: typeof terminal["gas_refunded_ptra"] === "bigint" ? (terminal["gas_refunded_ptra"] as bigint).toString() : null,
      bill: {
        fee_retained: res.bill.feeRetained.toString(),
        dynamic_gas_consumed: res.bill.dynamicGasConsumed.toString(),
        gas_refunded: res.bill.gasRefunded.toString(),
        total_agent_charge: res.bill.totalAgentCharge.toString(),
      },
    },
  };
});

const doc = {
  meta: {
    package: "@paradigm-terra/cal-validator",
    version: "0.1.0",
    spec_basis: "CAL Execution Specification v0.1.0-draft §3–§10 — lifecycle (§3), validator role (§4), capability matrix (Annex A DRAFT, 2026-05-28), signatures (§8.1/§8.2), nonce (§6), gas (§9), Bounded Mode (§10). §9.3 upfront escrow (2026-05-27): cal.validated emits escrow_ptra = Flat_Validation_Fee + Max_Expected_Dynamic_Gas; the terminal event carries gas_refunded_ptra so the treasury keeps escrow − refund (= fee + consumed) for every post-VALIDATED outcome. §9.4 Tier-2: pre-VALIDATED PRECOND_FALSE/CAPABILITY_DENIED retain min(fee, balance) on cal.failed; UNKNOWN_ACTION/NONCE_MISMATCH/PRECOND_ERROR retain nothing. §3.5: the §9.3 escrow-admission shortfall reports a dedicated INSUFFICIENT_ESCROW reason code, distinct from the post-VALIDATED OUT_OF_GAS dynamic-gas overrun. §10 (2026-05-28): when state.failure_mode.is_bounded_mode == true, the validator rejects any action absent from BOUNDED_MODE_WHITELIST with BOUNDED_BLOCKED (no-charge), escalates every action to owner-required per §10.4, and appends the DSL §7.1 emergency invariant set to the declared invariants per §10.3. §4.4 (2026-05-28): when the validator has pinned a non-empty mcp_schema_hash (trace.pinned_mcp_schema_hash), a mismatch with state.registry.mcp_schema_hash fails the CAL with SCHEMA_MISMATCH (no-charge, ingress-class). §8.1/§8.2 (2026-05-28): trace.operator_sig_present joins owner_sig_present (the node's verifier verdict; real Ed25519 curve arithmetic is deferred); the agent registry grows operator_pubkey + owner_pubkey, and gate 4 fails CAPABILITY_DENIED when a required *_sig is absent or the corresponding *_pubkey is missing from the registry (§9.4 spam charge).",
    generated_at: new Date().toISOString(),
    status:
      "PRE-NORMATIVE (PFC2-M5, 2026-06-11) — the PFC-2 Multisig v2.1 surface. (M4) owner-required actions carry ownerAuthUnits(k)=OWNER_AUTH_BASE+k×ED25519_VERIFY_WEIGHT, k=owner signatures verified (the v1 vectors use single-owner records ⇒ k=1, gas moved by 150 units×price). (M5) seven AuthorizationSet-v2 cases added in the SAME set: ms_quorum_pass (2-of-3 FINALIZED), ms_quorum_not_met (QUORUM_NOT_MET), ms_invalid_{duplicate,unsorted,non_owner,cardinality} (INVALID_SIGNATURE_SET), and ms_migrated_1of1_equals_v1 — the SC-4 anchor whose OUTPUT is byte-identical to the v1 single-owner treasury_finalized vector (asserted in golden-vectors.test.ts). PRE-NORMATIVE: the values moved deliberately (Tier C) and are NOT yet cross-language verified — validator-rs (PFC2-M6) and cal-validator-go (PFC2-M7) still produce the v1 numbers and lack the quorum gate. Promotion back to NORMATIVE is M6/M7 + the pfc2-consensus-freeze ruling. The TS reference reproduces every vector (ts-ops green); vectors-check (freeze-gate) is RED until re-promotion, by design. Operator path unchanged (non-owner actions byte-identical to v1).",
  },
  vectors,
};

await writeFile(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`Wrote ${vectors.length} validator vectors to ${OUTPUT_PATH}`);
