/**
 * Generate golden vectors for @paradigm-terra/cal v0.1.0 (CAL skeleton).
 *
 * Pins, for curated CAL blobs and receipt events:
 *   - the structural-validation outcome (valid, or {code, detail}),
 *   - CANONICAL_UNSIGNED (hex) and CAL_HASH for valid CALs,
 *   - EVENT_HASH / RECEIPT_HASH for events.
 *
 * Blobs are stored as canonical-JSON text so the Rust/Go parity ports re-parse
 * them identically. Promote PRE-NORMATIVE → NORMATIVE once cal-rs and cal-go
 * reproduce every field byte-for-byte.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical, toHex, type JcsValue } from "@paradigm-terra/canonical";
import {
  buildFinalized,
  buildNegative,
  calHash,
  canonicalUnsignedBytes,
  checkCal,
  eventHash,
  receiptHash,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "golden.json");

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const DEST = "0:83dfd552e63729b472fc4e4a8f8f83d4a8f4f3a3e3e3a3e3e3a3e3e3a3e3e3a3";
const SIG = "0x" + "ab".repeat(64);

function validCal(): Record<string, JcsValue> {
  return {
    cal_version: "0.1.0",
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 42n,
    expiration_tick: 1050000n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 100000000n } },
    invariants: [
      {
        op: "eq",
        lhs: { var: `state.after.registry.agents.${A}.frozen_until` },
        rhs: { var: `state.before.registry.agents.${A}.frozen_until` },
      },
    ],
    steps: [
      {
        verb: "wallet.send_ton",
        params: { to: DEST, amount_nano_ton: 50000000000n },
        post_conditions: [
          {
            op: "lt",
            lhs: { var: `state.after.registry.agents.${A}.wallet_balance_ton` },
            rhs: { var: `state.before.registry.agents.${A}.wallet_balance_ton` },
          },
        ],
      },
    ],
    receipt_required: true,
    signatures: { operator_sig: SIG },
  };
}

// Mutate a fresh valid CAL for the negative cases.
function mut(f: (c: Record<string, JcsValue>) => void): Record<string, JcsValue> {
  const c = validCal();
  f(c);
  return c;
}

interface CalSpec {
  id: string;
  description: string;
  cal: Record<string, JcsValue>;
}

const calSpecs: CalSpec[] = [
  { id: "valid_send_ton", description: "minimal happy-path wallet.send_ton CAL (§12.1)", cal: validCal() },
  { id: "unknown_action", description: "action not in taxonomy → UNKNOWN_ACTION", cal: mut((c) => (c.action = "wallet.teleport")) },
  { id: "bad_cal_version", description: "cal_version != 0.1.0 → BAD_CAL_VERSION", cal: mut((c) => (c.cal_version = "0.2.0")) },
  { id: "verb_namespace_mismatch", description: "step verb in a different namespace → VERB_NAMESPACE_MISMATCH", cal: mut((c) => ((c.steps as JcsValue[])[0] = { verb: "treasury.transfer", params: {} })) },
  { id: "bad_agent_id", description: "non-canonical agent_id → BAD_AGENT_ID", cal: mut((c) => (c.agent_id = "EQabc")) },
  { id: "bad_nonce", description: "nonce not a uint64 → BAD_NONCE", cal: mut((c) => (c.nonce = "42")) },
  { id: "empty_steps", description: "steps is empty → EMPTY_STEPS", cal: mut((c) => (c.steps = [])) },
  { id: "missing_operator_sig", description: "signatures without operator_sig → MISSING_FIELD", cal: mut((c) => (c.signatures = {})) },
  { id: "unexpected_field", description: "unknown top-level key → UNEXPECTED_FIELD", cal: mut((c) => (c.surprise = 1n)) },
  { id: "dsl_unknown_op", description: "embedded precondition with unknown operator → DSL_INVALID", cal: mut((c) => (c.preconditions = { op: "xor", lhs: { const: 1n }, rhs: { const: 2n } })) },
  { id: "dsl_bracketed_in_precondition", description: "state.after.* in precondition → DSL_INVALID/BRACKETED", cal: mut((c) => (c.preconditions = { op: "gte", lhs: { var: "state.after.x" }, rhs: { const: 0n } })) },
];

interface CalVector {
  id: string;
  description: string;
  cal_canonical: string;
  output: { valid: boolean; code?: string; detail?: string; cal_hash?: string; unsigned_bytes_hex?: string };
}

const cals: CalVector[] = calSpecs.map((s) => {
  const res = checkCal(s.cal);
  const out: CalVector["output"] = { valid: res.valid };
  if (res.code) out.code = res.code;
  if (res.detail) out.detail = res.detail;
  if (res.valid) {
    out.cal_hash = `0x${toHex(calHash(s.cal))}`;
    out.unsigned_bytes_hex = `0x${toHex(canonicalUnsignedBytes(s.cal))}`;
  }
  return { id: s.id, description: s.description, cal_canonical: serializeCanonical(s.cal as JcsValue), output: out };
});

// ---- receipt events ----
const finalized = buildFinalized({
  calHash: `0x${"9f8e7d6c".repeat(8)}`,
  agentId: A,
  nonce: 42n,
  tickFinalized: 1049982n,
  stateRootBefore: `0x${"aa".repeat(32)}`,
  stateRootAfter: `0x${"bb".repeat(32)}`,
  gasConsumedPtra: 12345n,
  tonIngressFeePaid: 5000000n,
  stepsApplied: 1n,
  invariantsChecked: 1n,
});
const failed = buildNegative({
  eventType: "cal.failed",
  calHash: `0x${"4a3b2c1d".repeat(8)}`,
  agentId: A,
  nonce: 44n,
  tick: 1050200n,
  reasonCode: "OUT_OF_GAS",
  reasonDetail: "step 0 consumed 850000 of 800000 budgeted units",
  gasConsumedPtra: 800000n,
  tonIngressFeePaid: 5000000n,
});

interface EventVector {
  id: string;
  description: string;
  event_canonical: string;
  output: { event_hash: string; receipt_hash: string };
}

const events: EventVector[] = [
  { id: "receipt_finalized", description: "cal.finalized positive receipt (§5.1)", ev: finalized },
  { id: "receipt_failed", description: "cal.failed negative receipt (§5.2)", ev: failed },
].map((e) => ({
  id: e.id,
  description: e.description,
  event_canonical: serializeCanonical(e.ev as JcsValue),
  output: { event_hash: `0x${toHex(eventHash(e.ev))}`, receipt_hash: `0x${toHex(receiptHash(e.ev))}` },
}));

const doc = {
  meta: {
    package: "@paradigm-terra/cal",
    version: "0.1.0",
    spec_basis: "CAL Execution Specification v0.1.0-draft — immutable hashable foundation (schema, CAL_HASH, signing payload, event/receipt hashing, lifecycle)",
    generated_at: new Date().toISOString(),
    status:
      "NORMATIVE — generated by the TypeScript reference implementation and verified byte-for-byte by the Rust (cal-rs) and Go (cal-go) parity implementations on 2026-05-25 (every validation outcome + detail, CAL_HASH, canonical unsigned bytes, and event/receipt hash; 17 checks in Go).",
  },
  cals,
  events,
};

await writeFile(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log(`Wrote ${cals.length} CAL vectors + ${events.length} event vectors to ${OUTPUT_PATH}`);
