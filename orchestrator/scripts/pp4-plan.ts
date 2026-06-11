/**
 * PFC2-M8-R1 — PP#4 offline proof (Framing B). OFFLINE, NO BROADCAST.
 *
 * Builds a quorum-authorized `treasury.transfer` (a frozen OWNER_REQUIRED action) signed by REAL
 * Contract-A owner envelopes (deterministic Ed25519 keys → a stable anchor root), runs it through the
 * orchestrator (validator→reducer→STATE_ROOT), and its sub-threshold twin. Proves, with no network:
 *   quorum-pass (2-of-3)  → FINALIZED, the transfer effect commits → a distinct STATE_ROOT (anchor payload)
 *   sub-threshold (1-of-3) → QUORUM_NOT_MET, the transfer effect does NOT commit
 * The PP#4-B broadcast (anchoring the quorum-finalized STATE_ROOT on testnet) is the GATED live step;
 * this builder never touches the network. See docs/notes/pp4-multisig-proof.md.
 */

import crypto from "node:crypto";
import { canonicalUnsignedBytes } from "@paradigm-terra/cal";
import { apply, genesis, getIn, type Json, type State } from "@paradigm-terra/cal-reducer";
import { computeOwnerSigners, signDataDigest, type ExecutionTrace, type OwnerCoSignature } from "@paradigm-terra/cal-validator";
import { run, type Program } from "../src/index.js";

const A = "0:" + "ab".repeat(32);
const FUND = 10n ** 18n;
const TS = 1780211353n;
const DOMAIN = "ooopalladiumsb.github.io";
const ADDR_HASH = "ab".repeat(32);

// Deterministic Ed25519 keypairs from fixed 32-byte seeds (PKCS8) → reproducible pubkeys → a stable
// anchor STATE_ROOT (so the PP#4 plan artifact is byte-stable across runs).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function keyFromSeed(seedByte: string): { sk: crypto.KeyObject; pub: string } {
  const seed = Buffer.from(seedByte.repeat(32), "hex");
  const sk = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const der = crypto.createPublicKey(sk).export({ type: "spki", format: "der" }) as Buffer;
  // RAW hex (no 0x): owner pubkeys flow into ed25519 verification (computeOwnerSigners), which needs
  // raw bytes; the registry owners[] and the trace ownerSigners use the SAME raw form so they match.
  return { sk, pub: der.subarray(der.length - 32).toString("hex") };
}

const operatorKey = keyFromSeed("0f");
const ownerKeys = [keyFromSeed("01"), keyFromSeed("02"), keyFromSeed("03")];
// Registry owners[] must be sorted ascending by pubkey (the canonical form, §3).
const ownersSorted = [...ownerKeys].sort((a, b) => (a.pub < b.pub ? -1 : a.pub > b.pub ? 1 : 0));
const OWNERS = ownersSorted.map((k) => k.pub);

/** The treasury.transfer CAL (mirrors the frozen `treasury_finalized` golden vector). */
function treasuryCal(): Json {
  return {
    cal_version: "0.1.0",
    action: "treasury.transfer",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 200n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 0n } },
    invariants: [{ op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { var: "state.before.treasury.nav" } }],
    steps: [{ verb: "treasury.transfer", params: { amount_nano_ptra: 10n }, post_conditions: [{ op: "gte", lhs: { var: "state.after.treasury.nav" }, rhs: { const: 0n } }] }],
    receipt_required: true,
  } as Json;
}

/** One Contract-A owner co-signature envelope over the canonical (unsigned) CAL bytes. */
function ownerEnvelope(sk: crypto.KeyObject, canonicalB64: string): OwnerCoSignature {
  const digest = signDataDigest({ workchain: 0, addressHashHex: ADDR_HASH, domain: DOMAIN, timestamp: TS, payload: { type: "binary", bytesB64: canonicalB64 } });
  return { calCanonicalBytesB64: canonicalB64, workchain: 0, addressHashHex: ADDR_HASH, domain: DOMAIN, timestamp: TS, signatureB64: crypto.sign(null, digest, sk).toString("base64") };
}

function fundedState(): State {
  const g = genesis() as unknown as { ptra: { balances: Record<string, Json> }; registry: { agents: Record<string, Json> }; treasury: Record<string, Json> };
  g.ptra.balances[A] = FUND;
  g.treasury.nav = 0n;
  // v2 AuthorizationSet: owners[]/threshold (threshold 2-of-3), treasury scope.
  g.registry.agents[A] = { granted_scopes: ["treasury_access:transfer"], operator_pubkey: operatorKey.pub, owners: OWNERS, threshold: 2n };
  return g as unknown as State;
}

/** Build a submission whose trace carries `signerCount` real owner co-signatures (presented sorted). */
function submission(signerCount: number) {
  const cal = treasuryCal();
  const canonicalB64 = Buffer.from(canonicalUnsignedBytes(cal)).toString("base64");
  // Present the lowest-pubkey owners (already sorted), each a real Contract-A envelope.
  const envelopes = ownersSorted.slice(0, signerCount).map((k) => ownerEnvelope(k.sk, canonicalB64));
  const ownerSigners = computeOwnerSigners(envelopes, OWNERS); // node verifies → matched pubkeys, presented order
  const operatorSigPresent = crypto.verify(null, canonicalUnsignedBytes(cal), crypto.createPublicKey(operatorKey.sk), crypto.sign(null, canonicalUnsignedBytes(cal), operatorKey.sk));
  const trace: ExecutionTrace = {
    currentTick: 0n,
    steps: [{ ok: true, effects: [{ ns: "ptra", op: "set", path: ["counters", "x"], value: 1n }] }],
    stateBefore: { treasury: { nav: 0n }, x: 5n } as Json,
    stateAfter: { treasury: { nav: 5n }, x: 1n } as Json,
    operatorSigPresent,
    ownerSigners,
  };
  return { cal: { ...cal, signatures: { owner_sigs: envelopes } } as Json, trace };
}

export interface Pp4Proof {
  readonly quorumPass: { terminalStage: string | null; reasonCode: string | null; anchorRoot: string; counterCommitted: boolean };
  readonly subThreshold: { terminalStage: string | null; reasonCode: string | null; counterCommitted: boolean };
  readonly plan: Json;
}

/** Run both submissions through the real orchestrator path. Pure/offline. */
export function buildPp4Proof(): Pp4Proof {
  // quorum-pass: 2 of 3 ≥ threshold 2 → FINALIZED, effect commits.
  const passProgram: Program = { genesisState: fundedState(), ticks: [{ tick: 0n, submissions: [submission(2)] }] };
  const passT = run(passProgram);
  const passSub = passT.ticks[0]!.submissions[0]!;
  // The committed effect is visible by replaying the log to the final state.
  const passState = replayFinal(passT.genesisState, passT.eventLog);
  const passCounter = getIn(passState, ["ptra", "counters", "x"]) === 1n;

  // sub-threshold: 1 of 3 < threshold 2 → QUORUM_NOT_MET, effect does NOT commit.
  const failProgram: Program = { genesisState: fundedState(), ticks: [{ tick: 0n, submissions: [submission(1)] }] };
  const failT = run(failProgram);
  const failSub = failT.ticks[0]!.submissions[0]!;
  const failState = replayFinal(failT.genesisState, failT.eventLog);
  const failCounter = getIn(failState, ["ptra", "counters", "x"]) === 1n;

  const plan: Json = {
    result: "PP#4-R1 OFFLINE (no broadcast)",
    framing: "B — anchor a quorum-authorized treasury.transfer STATE_ROOT (in-charter)",
    network: "ton-testnet (anchor planned, GATED — PP#4-B)",
    agent: A,
    authorization_set: { owners: OWNERS, threshold: "2" },
    quorum_pass: { signers_presented: 2, terminal_stage: passSub.terminalStage, reason_code: passSub.reasonCode, effect_committed: passCounter, anchor_state_root: passT.finalStateRoot },
    sub_threshold: { signers_presented: 1, terminal_stage: failSub.terminalStage, reason_code: failSub.reasonCode, effect_committed: failCounter },
    anchor_payload: { state_root: passT.finalStateRoot, note: "the quorum-finalized consensus STATE_ROOT; PP#4-B commits this on ton-testnet" },
    broadcast: "GATED — requires explicit go-ahead + funded testnet operator + key custody (PP#4-B)",
  };

  return {
    quorumPass: { terminalStage: passSub.terminalStage, reasonCode: passSub.reasonCode, anchorRoot: passT.finalStateRoot, counterCommitted: passCounter },
    subThreshold: { terminalStage: failSub.terminalStage, reasonCode: failSub.reasonCode, counterCommitted: failCounter },
    plan,
  };
}

/** Fold the event log to the final state (replay), so committed effects are observable. */
function replayFinal(genesisState: State, eventLog: readonly Event[]): State {
  let s = genesisState;
  for (const e of eventLog) {
    const r = apply(s, e as unknown as Json);
    if (r.ok) s = r.state;
  }
  return s;
}

// CLI: write the offline plan artifact (no network).
if (import.meta.url === `file://${process.argv[1]}`) {
  const proof = buildPp4Proof();
  process.stdout.write(JSON.stringify(proof.plan, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
}
