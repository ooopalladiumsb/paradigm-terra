/**
 * PFC2-M3 — multisig registry: the v1→v2 migration and the well-formed owner-record bound.
 * Implements `pfc2-m1-multisig-semantics.md` §1.1/§4.
 *   - migrateRegistryV1ToV2: deterministic, pure (no external input), idempotent, 1-of-1 bridge.
 *   - ownerRecordWellFormed: the §1.1 invariant (sorted/distinct/1≤threshold≤len≤16).
 *   - delta-commit enforcement: a CAL effect writing a malformed owner record → BAD_OWNER_RECORD.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDeltaJson,
  genesis,
  getIn,
  materialize,
  migrateRegistryV1ToV2,
  ownerRecordWellFormed,
  MAX_OWNERS,
  type Json,
  type State,
} from "../src/index.js";

const A = "0:" + "ab".repeat(32).slice(0, 64);
const B = "0:" + "cd".repeat(32).slice(0, 64);
const K1 = "0x" + "a1".repeat(32);
const K2 = "0x" + "b2".repeat(32);

function v1State(): State {
  const g = genesis();
  (g.registry as { agents: Record<string, Json> }).agents = {
    [A]: { granted_scopes: ["ptra_stake"], operator_pubkey: "0x" + "11".repeat(32), owner_pubkey: K1 },
    [B]: { granted_scopes: [], operator_pubkey: "0x" + "22".repeat(32), owner_pubkey: "" }, // no-owner agent
  };
  return g;
}

// ---- migration -----------------------------------------------------------

test("migrate: owner_pubkey → owners:[K], threshold:1; v1 key removed (1-of-1 bridge)", () => {
  const m = migrateRegistryV1ToV2(v1State());
  assert.deepEqual(getIn(m, ["registry", "agents", A, "owners"]), [K1]);
  assert.equal(getIn(m, ["registry", "agents", A, "threshold"]), 1n);
  assert.equal(getIn(m, ["registry", "agents", A, "owner_pubkey"]), undefined);
});

test("migrate: empty owner_pubkey → owners:[], threshold:0 (no-owner record)", () => {
  const m = migrateRegistryV1ToV2(v1State());
  assert.deepEqual(getIn(m, ["registry", "agents", B, "owners"]), []);
  assert.equal(getIn(m, ["registry", "agents", B, "threshold"]), 0n);
});

test("migrate is deterministic and pure (same input → byte-equal output; input untouched)", () => {
  const s1 = v1State();
  const before = JSON.stringify(s1, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  const a = migrateRegistryV1ToV2(s1);
  const b = migrateRegistryV1ToV2(v1State());
  const ser = (s: State) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  assert.equal(ser(a), ser(b)); // deterministic
  assert.equal(JSON.stringify(s1, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)), before); // pure: input unchanged
});

test("migrate is idempotent (already-v2 agents untouched)", () => {
  const once = migrateRegistryV1ToV2(v1State());
  const twice = migrateRegistryV1ToV2(once);
  const ser = (s: State) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  assert.equal(ser(once), ser(twice));
});

// ---- well-formed invariant ----------------------------------------------

test("ownerRecordWellFormed: §1.1 cases", () => {
  assert.equal(ownerRecordWellFormed([K1], 1n), true);
  assert.equal(ownerRecordWellFormed([K1, K2], 2n), true);
  assert.equal(ownerRecordWellFormed([K1, K2], 1n), true);
  assert.equal(ownerRecordWellFormed([K2, K1], 1n), false); // unsorted
  assert.equal(ownerRecordWellFormed([K1, K1], 1n), false); // duplicate
  assert.equal(ownerRecordWellFormed([K1], 0n), false); // threshold < 1
  assert.equal(ownerRecordWellFormed([K1], 2n), false); // threshold > len
  assert.equal(ownerRecordWellFormed([], 1n), false); // empty
  assert.equal(ownerRecordWellFormed(Array(MAX_OWNERS + 1).fill(K1), 1n), false); // > MAX_OWNERS
});

// ---- delta-commit enforcement -------------------------------------------

test("delta enforce: well-formed owner record commits", () => {
  let s = genesis();
  s = applyDeltaJson(s, { ns: "registry", op: "set", path: ["agents", A, "owners"], value: [K1, K2] });
  s = applyDeltaJson(s, { ns: "registry", op: "set", path: ["agents", A, "threshold"], value: 2n });
  assert.deepEqual(getIn(s, ["registry", "agents", A, "owners"]), [K1, K2]);
});

test("delta enforce: malformed owner record (threshold > len) → BAD_OWNER_RECORD on commit", () => {
  let s = genesis();
  s = applyDeltaJson(s, { ns: "registry", op: "set", path: ["agents", A, "owners"], value: [K1] });
  assert.throws(
    () => applyDeltaJson(s, { ns: "registry", op: "set", path: ["agents", A, "threshold"], value: 5n }),
    /BAD_OWNER_RECORD/,
  );
});

test("delta enforce: unsorted owners → BAD_OWNER_RECORD; partial record (no threshold yet) is allowed transiently", () => {
  let s = genesis();
  // partial: owners present, threshold absent → allowed (intermediate)
  s = applyDeltaJson(s, { ns: "registry", op: "set", path: ["agents", A, "owners"], value: [K2, K1] });
  // completes the record → invariant fires
  assert.throws(
    () => applyDeltaJson(s, { ns: "registry", op: "set", path: ["agents", A, "threshold"], value: 1n }),
    /BAD_OWNER_RECORD/,
  );
});

test("delta enforce via full CAL lifecycle: malformed owners in staged effects fails at finalize", () => {
  const g = genesis();
  (g.ptra as { balances: Record<string, Json> }).balances[A] = 1_000_000n;
  const events: { [k: string]: Json }[] = [
    { event_type: "cal.created", cal_hash: `0x${"11".repeat(32)}`, agent_id: A },
    { event_type: "cal.signed", cal_hash: `0x${"11".repeat(32)}` },
    { event_type: "cal.validated", cal_hash: `0x${"11".repeat(32)}`, escrow_ptra: 100_000n },
    {
      event_type: "cal.executed",
      cal_hash: `0x${"11".repeat(32)}`,
      gas_consumed_ptra: 0n,
      effects: [
        { ns: "registry", op: "set", path: ["agents", A, "owners"], value: [K1] },
        { ns: "registry", op: "set", path: ["agents", A, "threshold"], value: 9n }, // > len
      ],
    },
    { event_type: "cal.settled", cal_hash: `0x${"11".repeat(32)}` },
    { event_type: "cal.finalized", cal_hash: `0x${"11".repeat(32)}`, gas_refunded_ptra: 0n },
  ];
  const r = materialize(events, g);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "BAD_OWNER_RECORD");
});
