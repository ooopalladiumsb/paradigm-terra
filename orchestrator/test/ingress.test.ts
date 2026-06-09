/**
 * Gate #1 contour proof: real signatures → verifyIngress() → trace booleans → validate() →
 * FINALIZED. Uses freshly generated test Ed25519 keys (Node crypto) to produce REAL signatures:
 *   operator_sig — raw Ed25519 over canonical_bytes(cal_without_signatures)
 *   owner_sig    — Ed25519 over the Contract A signData commit (envelope object)
 * No manual adapter: the trace booleans are DERIVED from the signatures, not injected.
 *
 * This is the crypto-suite (real verification). The lifecycle golden vectors remain on injected
 * booleans by design — they exercise the state machine, not signature verification.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import { genesis, type Json, type State } from "@paradigm-terra/cal-reducer";
import { canonicalUnsignedBytes } from "@paradigm-terra/cal";
import { signDataDigest, type ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, verifyIngress, type Program } from "../src/index.js";

const A = "0:" + "aa".repeat(32);
const FUND = 10n ** 18n;
const TS = 1780211353n;
const DOMAIN = "ooopalladiumsb.github.io";

function rawPub(pk: crypto.KeyObject): string {
  const der = pk.export({ type: "spki", format: "der" }) as Buffer;
  return der.subarray(der.length - 32).toString("hex"); // last 32 bytes = raw Ed25519 key
}
const signRaw = (msg: Uint8Array, sk: crypto.KeyObject): string =>
  "0x" + crypto.sign(null, Buffer.from(msg), sk).toString("hex");

const opKp = crypto.generateKeyPairSync("ed25519");
const ownerKp = crypto.generateKeyPairSync("ed25519");
const OP_PUB = "0x" + rawPub(opKp.publicKey);
const OWNER_PUB = "0x" + rawPub(ownerKp.publicKey);
const reg = { operator_pubkey: OP_PUB, owner_pubkey: OWNER_PUB };

function baseCal(): Json {
  return {
    action: "wallet.send_ton",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
  } as Json;
}

function signedCal(): Json {
  const cal = baseCal();
  const canonical = canonicalUnsignedBytes(cal); // exactly what operator signs (SIGN_PAYLOAD)
  const operator_sig = signRaw(canonical, opKp.privateKey);
  // owner signs the Contract A commit over the same canonical bytes
  const digest = signDataDigest({
    workchain: 0,
    addressHashHex: "aa".repeat(32),
    domain: DOMAIN,
    timestamp: TS,
    payload: { type: "binary", bytesB64: Buffer.from(canonical).toString("base64") },
  });
  const owner_sig = {
    signature: signRaw(digest, ownerKp.privateKey),
    domain: DOMAIN,
    timestamp: TS,
    workchain: 0n,
    address_hash: "0x" + "aa".repeat(32),
  };
  return { ...cal, signatures: { operator_sig, owner_sig } } as Json;
}

function stateWithKeys(): State {
  const g = genesis() as unknown as {
    ptra: { balances: Record<string, Json> };
    registry: { agents: Record<string, Json> };
  };
  g.ptra.balances[A] = FUND;
  g.registry.agents[A] = { granted_scopes: ["ton_transfer"], operator_pubkey: OP_PUB, owner_pubkey: OWNER_PUB };
  return g as unknown as State;
}

test("verifyIngress derives TRUE verdicts from real operator(raw) + owner(Contract A) signatures", () => {
  assert.deepEqual(verifyIngress(signedCal(), reg), { operatorSigPresent: true, ownerSigPresent: true });
});

test("real signatures → verifyIngress → trace → validate() → FINALIZED (Gate #1 contour)", () => {
  const cal = signedCal();
  const v = verifyIngress(cal, reg);
  const trace: ExecutionTrace = {
    currentTick: 0n,
    steps: [{ ok: true, effects: [] }],
    stateBefore: {} as Json,
    stateAfter: {} as Json,
    operatorSigPresent: v.operatorSigPresent,
    ownerSigPresent: v.ownerSigPresent,
  };
  const program: Program = { genesisState: stateWithKeys(), ticks: [{ tick: 0n, submissions: [{ cal, trace }] }] };
  const t = run(program);
  assert.equal(t.ticks[0]!.submissions[0]!.terminalStage, "FINALIZED");
});

test("negatives: wrong pubkey, tampered sig, and legacy owner_sig (no backfill, D-S4)", () => {
  const cal = signedCal();
  const sigs = (cal as Record<string, Json>)["signatures"] as Record<string, Json>;

  // wrong operator pubkey
  assert.equal(verifyIngress(cal, { operator_pubkey: OWNER_PUB, owner_pubkey: OWNER_PUB }).operatorSigPresent, false);

  // tampered operator signature
  const opHex = sigs["operator_sig"] as string;
  const flipped = opHex.slice(0, -1) + (opHex.endsWith("a") ? "b" : "a");
  const calBadOp = { ...cal, signatures: { ...sigs, operator_sig: flipped } } as Json;
  assert.equal(verifyIngress(calBadOp, reg).operatorSigPresent, false);

  // legacy hex-string owner_sig: schema-tolerated but NOT verifiable — no backfill → false
  const calLegacy = { ...cal, signatures: { operator_sig: sigs["operator_sig"], owner_sig: "0x" + "22".repeat(64) } } as Json;
  assert.equal(verifyIngress(calLegacy, reg).ownerSigPresent, false);

  // missing owner key → false (no rescue from elsewhere)
  assert.equal(verifyIngress(cal, { operator_pubkey: OP_PUB }).ownerSigPresent, false);
});
