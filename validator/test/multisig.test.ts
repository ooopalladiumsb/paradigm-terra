/**
 * PFC2-M2 — the multisig (AuthorizationSet v2) owner-authorization gate.
 * Implements `pfc2-m1-multisig-semantics.md` §2:
 *   - validate() is PURE over trace.ownerSigners (the node's presented-order owner-match verdicts);
 *   - structural failures (unsorted/duplicate/non-owner/cardinality) → INVALID_SIGNATURE_SET,
 *     checked BEFORE the quorum count → QUORUM_NOT_MET;
 *   - 1-of-1 reproduces the v1 single-owner outcome (behaviour-identity, SC-4);
 *   - the legacy v1 single-owner branch (owner_pubkey, no owners[]) is untouched.
 * One end-to-end test drives the real node helper computeOwnerSigners() with real Ed25519 keys.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { test } from "node:test";
import {
  validate,
  computeOwnerSigners,
  signDataDigest,
  type ExecutionTrace,
  type OwnerCoSignature,
  type Json,
} from "../src/index.js";

const A = "0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf";
const CH = "0x" + "11".repeat(32);

// Three owner pubkeys, already in ascending (string == raw-byte for equal length) order.
const K1 = "0x" + "a1".repeat(32);
const K2 = "0x" + "b2".repeat(32);
const K3 = "0x" + "c3".repeat(32);

/** A v2 (multi-owner) agent snapshot: owners[] + threshold instead of owner_pubkey. */
function snapshot(owners: string[], threshold: bigint, nonce = 0n): Json {
  return {
    cal: { in_flight: {}, nonces: { [A]: nonce } },
    governance: { params: {} },
    ptra: { balances: { [A]: 10n ** 18n } },
    registry: {
      agents: {
        [A]: {
          granted_scopes: ["ptra_stake"], // ptra.stake is owner-required AND scope-gated
          operator_pubkey: "0x" + "11".repeat(32),
          owners,
          threshold,
        },
      },
    },
  } as Json;
}

/** A v1 (single-owner) agent snapshot: legacy owner_pubkey, no owners[]. */
function snapshotV1(nonce = 0n): Json {
  return {
    cal: { in_flight: {}, nonces: { [A]: nonce } },
    governance: { params: {} },
    ptra: { balances: { [A]: 10n ** 18n } },
    registry: {
      agents: {
        [A]: { granted_scopes: ["ptra_stake"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: K1 },
      },
    },
  } as Json;
}

function cal(): Json {
  return {
    action: "ptra.stake",
    agent_id: A,
    nonce: 1n,
    expiration_tick: 100n,
    preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${A}` }, rhs: { const: 1n } },
    invariants: [],
    steps: [{ verb: "ptra.stake", params: {}, post_conditions: [] }],
  } as Json;
}

function trace(ownerSigners: string[] | undefined, ownerSigPresent = true): ExecutionTrace {
  return {
    currentTick: 0n,
    steps: [{ ok: true, effects: [] }],
    stateBefore: {} as Json,
    stateAfter: {} as Json,
    operatorSigPresent: true,
    ownerSigPresent,
    ownerSigners,
  };
}

test("2-of-3 quorum met → FINALIZED", () => {
  const r = validate(cal(), CH, snapshot([K1, K2, K3], 2n), trace([K1, K2]));
  assert.equal(r.terminalStage, "FINALIZED");
  assert.equal(r.reasonCode, null);
});

test("1-of-3 presented for a 2-of-3 agent → QUORUM_NOT_MET (spam-charged, no validated)", () => {
  const r = validate(cal(), CH, snapshot([K1, K2, K3], 2n), trace([K1]));
  assert.equal(r.terminalStage, "FAILED");
  assert.equal(r.reasonCode, "QUORUM_NOT_MET");
  assert.ok(!r.events.some((e) => e["event_type"] === "cal.validated"));
});

test("unsorted owner_sigs → INVALID_SIGNATURE_SET (before quorum)", () => {
  const r = validate(cal(), CH, snapshot([K1, K2, K3], 2n), trace([K2, K1]));
  assert.equal(r.reasonCode, "INVALID_SIGNATURE_SET");
});

test("duplicate signer → INVALID_SIGNATURE_SET (no double-count)", () => {
  const r = validate(cal(), CH, snapshot([K1, K2, K3], 2n), trace([K1, K1]));
  assert.equal(r.reasonCode, "INVALID_SIGNATURE_SET");
});

test("non-owner signer (empty match) → INVALID_SIGNATURE_SET", () => {
  const r = validate(cal(), CH, snapshot([K1, K2, K3], 2n), trace([K1, ""]));
  assert.equal(r.reasonCode, "INVALID_SIGNATURE_SET");
});

test("cardinality > owners → INVALID_SIGNATURE_SET", () => {
  const r = validate(cal(), CH, snapshot([K1, K2], 1n), trace([K1, K2, K3]));
  assert.equal(r.reasonCode, "INVALID_SIGNATURE_SET");
});

test("1-of-1 degenerate case reproduces the v1 single-owner FINALIZED outcome (SC-4)", () => {
  const v2 = validate(cal(), CH, snapshot([K1], 1n), trace([K1]));
  const v1 = validate(cal(), CH, snapshotV1(), trace(undefined, true));
  assert.equal(v2.terminalStage, "FINALIZED");
  assert.equal(v1.terminalStage, "FINALIZED");
  // behaviour-identity: same terminal stage AND same event sequence (only encoding differs).
  assert.deepEqual(v2.events.map((e) => e["event_type"]), v1.events.map((e) => e["event_type"]));
});

test("v1 single-owner branch is untouched (no owners[] ⇒ legacy ownerSigPresent gate)", () => {
  const ok = validate(cal(), CH, snapshotV1(), trace(undefined, true));
  assert.equal(ok.terminalStage, "FINALIZED");
  const denied = validate(cal(), CH, snapshotV1(), trace(undefined, false)); // ownerSigPresent=false
  assert.equal(denied.reasonCode, "CAPABILITY_DENIED");
});

test("end-to-end: computeOwnerSigners (real Ed25519) feeds the quorum gate", () => {
  // Real keys; build a Contract-A signData/binary envelope per owner over the same CAL bytes.
  const bytesB64 = Buffer.from("pfc2-m2-canonical-cal-bytes").toString("base64");
  const env = { workchain: 0, addressHashHex: "00".repeat(32), domain: "paradigm-terra.app", timestamp: 1718000000 };

  function ownerAndEnvelope(): { pubHex: string; envelope: OwnerCoSignature } {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32); // last 32 bytes = raw pubkey
    const pubHex = raw.toString("hex");
    const digest = signDataDigest({ ...env, payload: { type: "binary", bytesB64 } });
    const signatureB64 = edSign(null, digest, privateKey).toString("base64");
    return { pubHex, envelope: { ...env, calCanonicalBytesB64: bytesB64, signatureB64 } };
  }

  const a = ownerAndEnvelope();
  const b = ownerAndEnvelope();
  const owners = [a.pubHex, b.pubHex].sort(); // registry stores sorted, distinct
  // Present envelopes in matched-pubkey ascending order (what an honest node emits).
  const present = owners.map((pk) => (pk === a.pubHex ? a.envelope : b.envelope));
  const signers = computeOwnerSigners(present, owners);
  assert.deepEqual([...signers].sort(), [...owners].sort(), "both envelopes match their owner");

  const r = validate(cal(), CH, snapshot(owners, 2n), trace(signers));
  assert.equal(r.terminalStage, "FINALIZED");
});
