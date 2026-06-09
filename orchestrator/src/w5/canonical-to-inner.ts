/**
 * Annex F (DRAFT) — `canonical_to_inner`: CAL `action`/`steps` → Wallet-V5 `InnerRequest`.
 *
 * Decided in `docs/notes/cal-to-w5-mapping-review.md`:
 *  - The §6.1 "OutList vs ActionList" decision point is a FALSE dichotomy. W5's InnerRequest
 *    carries both arms; the codec is a VERB-CLASS DISPATCH (message verbs → OutList
 *    `action_send_msg`; wallet-config verbs → ExtendedActions; read/cancel → neither).
 *  - v0.1.0 implements the OutList arm only (it covers every end-to-end-proven verb;
 *    `wallet.send_ton`, a bare transfer, is the single verb with a body encoder here).
 *
 * SCOPE (honest, per the review §3.1 "no offline oracle"): this emits a typed `InnerRequest`
 * **IR** — the model-bearing CAL→W5-action projection — NOT serialized BoC cells. The cell/BoC
 * encoding (`ir_to_boc`, mechanical TL-B per the V5 spec) is the network-gated follow-on; ALL
 * the integration-model risk lives in the mapping below, which is what these invariants pin.
 *
 * PUBLICATION-LAYER RULE (architect-ruled 2026-06-03, `pfc1-status-review.md`):
 *   TON-valid ⊆ CAL-valid — publication MAY shorten authorization, MUST NEVER extend it.
 *   At the action level this codec enforces: faithful value (no inflation), faithful dest (no
 *   redirection), no fan-out (≤ one action per effect-step), and a fixed-value send mode (never
 *   the carry-remaining / carry-all bits, which would move more than the CAL specified).
 *
 * NOT in the Freeze Surface (publication is §8.3 out-of-scope). DRAFT until the on-chain leg (H3.1).
 */

import type { Json } from "@paradigm-terra/cal-reducer";

/** W5 send mode for an exact-value transfer: pay fees separately, recipient gets exactly `value`. */
export const SEND_MODE_EXACT = 1;
/** Mode bits that would move MORE than the CAL specified — forbidden (would extend authorization). */
export const CARRY_REMAINING = 64;
export const CARRY_ALL = 128;

/** One relaxed internal message the wallet emits (the `out_msg` of a W5 `action_send_msg`). */
export interface OutMessage {
  /** Destination address (agent-supplied via step params). Raw form; friendly encodings are non-normative. */
  readonly dest: string;
  /** Exact value to send, in nano-TON. */
  readonly valueNano: bigint;
  /** Message body intent (opaque for v0.1.0; null for a bare transfer). */
  readonly body: Json | null;
}

/** A W5 standard output action (the OutList arm). */
export interface SendAction {
  readonly type: "action_send_msg";
  readonly mode: number;
  readonly msg: OutMessage;
}

/**
 * The W5 signed-body `InnerRequest` (IR form). v0.1.0 populates only `outActions`; `extended`
 * (ExtendedActions: add/delete extension, set_signature_auth_allowed) is reserved for the
 * bounded-mode / governance verbs (cal-validator-design §10.3) and stays empty here.
 */
export interface InnerRequest {
  readonly outActions: readonly SendAction[];
  readonly extended: readonly never[];
}

/** W5 action class of a CAL step verb (Annex F normative table; mirrors CAL §2.3). */
export type VerbClass = "send" | "config" | "offchain" | "unknown";

// §2.3 message verbs — project to an outbound message (OutList). (Body encoders beyond send_ton
// are deferred in v0.1.0; the class is still `send`.)
const SEND_VERBS: ReadonlySet<string> = new Set([
  "wallet.send_ton", "wallet.send_jetton", "wallet.send_nft",
  "treasury.transfer", "treasury.distribute_rewards", "treasury.buyback_burn",
  "governance.propose_amendment", "governance.vote", "governance.vote_as_agent", "governance.finalize_amendment",
  "oracles.submit_feed", "oracles.slash", "oracles.force_update",
  "ptra.stake", "ptra.unstake", "ptra.claim_rewards",
  "agent.register", "agent.migrate", "agent.freeze", "agent.unfreeze",
  "capability.update", "capability.temporal_boost_request", "capability.temporal_boost_release",
  "failure_mode.emergency_withdraw",
]);
// Wallet self-config → ExtendedActions (§10.3 pins enter/exit_bounded ↔ set_signature_allowed).
const CONFIG_VERBS: ReadonlySet<string> = new Set(["failure_mode.enter_bounded", "failure_mode.exit_bounded"]);
// Off-chain lifecycle — no W5 action.
const OFFCHAIN_VERBS: ReadonlySet<string> = new Set(["cal.cancel"]);
// v0.1.0 verbs with a concrete body encoder (the rest of `send` is recognized-but-unimplemented).
const V0_1_0_ENCODABLE: ReadonlySet<string> = new Set(["wallet.send_ton"]);

/** Classify a step verb. `get_*` reads are always off-chain (no on-chain effect). */
export function classifyVerb(verb: string): VerbClass {
  const rest = verb.split(".")[1] ?? "";
  if (rest.startsWith("get_")) return "offchain";
  if (OFFCHAIN_VERBS.has(verb)) return "offchain";
  if (CONFIG_VERBS.has(verb)) return "config";
  if (SEND_VERBS.has(verb)) return "send";
  return "unknown";
}

export class W5CodecError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "W5CodecError";
  }
}

function asObj(v: Json | undefined): { [k: string]: Json } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return v as { [k: string]: Json };
}

/** Encode one `wallet.send_ton` step's params into an exact-value, no-carry SendAction. */
function encodeSendTon(params: Json | undefined): SendAction {
  const p = asObj(params);
  const dest = p["to"];
  const amount = p["amount_nano"];
  if (typeof dest !== "string" || dest === "") throw new W5CodecError("W5_MALFORMED_PARAMS", "wallet.send_ton requires params.to (address string)");
  if (typeof amount !== "bigint") throw new W5CodecError("W5_MALFORMED_PARAMS", "wallet.send_ton requires params.amount_nano (integer)");
  if (amount < 0n) throw new W5CodecError("W5_MALFORMED_PARAMS", "amount_nano must be non-negative");
  return { type: "action_send_msg", mode: SEND_MODE_EXACT, msg: { dest, valueNano: amount, body: p["body"] ?? null } };
}

/**
 * Project a validated CAL's steps onto a W5 `InnerRequest` (OutList arm).
 *
 * The CAL's guards (preconditions/post_conditions/invariants) do NOT cross — the external is the
 * UNCONDITIONAL realization of an already-validated CAL (review §6.2). `read`/`cancel` steps are
 * codec no-ops (§6.3). `config` verbs and unknown verbs are rejected (no silent drop / mis-encode).
 */
export function canonicalToInner(cal: Json): InnerRequest {
  const c = asObj(cal);
  const steps = Array.isArray(c["steps"]) ? (c["steps"] as Json[]) : [];
  const outActions: SendAction[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = asObj(steps[i]);
    const verb = typeof step["verb"] === "string" ? step["verb"] : "";
    switch (classifyVerb(verb)) {
      case "offchain":
        continue; // no on-chain action (read / cancel)
      case "config":
        throw new W5CodecError("W5_EXTENDED_NOT_IN_V0_1_0", `step ${i} verb ${verb} maps to ExtendedActions, not implemented in v0.1.0`);
      case "unknown":
        throw new W5CodecError("W5_UNKNOWN_VERB", `step ${i} verb ${JSON.stringify(verb)} is not a §2.3 registered verb`);
      case "send": {
        if (!V0_1_0_ENCODABLE.has(verb)) {
          throw new W5CodecError("W5_UNIMPLEMENTED_VERB", `step ${i} verb ${verb} is a message verb but has no v0.1.0 body encoder (only wallet.send_ton)`);
        }
        outActions.push(encodeSendTon(step["params"]));
      }
    }
  }

  if (outActions.length > 255) {
    throw new W5CodecError("W5_TOO_MANY_ACTIONS", `${outActions.length} actions exceed the W5 OutList limit of 255`);
  }
  return { outActions, extended: [] };
}
