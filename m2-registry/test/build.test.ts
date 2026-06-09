// M2-A · SC-1 — build reproducibility + record-schema round-trip.
// These are the SC-1 acceptance checks: the contract compiles, the build is DETERMINISTIC (same source
// + pinned compiler ⇒ identical codeHashHex), the committed artifact matches a fresh build, and the TS
// record codec agrees with the on-chain bit layout. No reconciliation logic, no network (that is M2-B/C).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Address } from "@ton/core";
import { compile } from "../scripts/build.ts";
import {
  buildRecordCell,
  parseRecordCell,
  buildUpsertBody,
  SettlementStatus,
  type ReconciliationRecord,
} from "../src/record.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = join(ROOT, "build", "registry.compiled.json");

test("SC-1: contract compiles through the pinned Tolk compiler", async () => {
  const art = await compile();
  assert.equal(art.tolkVersion, "1.4.1", "pinned compiler version");
  assert.match(art.codeHashHex, /^[0-9A-Fa-f]{64}$/, "code hash is a 256-bit hex");
  assert.ok(art.codeBoc64.length > 0, "non-empty code BoC");
});

test("SC-1: build is deterministic (two compiles ⇒ identical code hash)", async () => {
  const a = await compile();
  const b = await compile();
  assert.equal(a.codeHashHex, b.codeHashHex, "codeHashHex must be reproducible");
  assert.equal(a.codeBoc64, b.codeBoc64, "codeBoc64 must be byte-identical");
});

test("SC-1: committed artifact matches a fresh build (no drift)", async () => {
  const committed = JSON.parse(readFileSync(ARTIFACT, "utf-8"));
  const fresh = await compile();
  assert.equal(committed.codeHashHex, fresh.codeHashHex, "committed build/registry.compiled.json is stale — re-run `npm run build`");
  assert.equal(committed.tolkVersion, fresh.tolkVersion);
});

test("SC-1: record schema round-trips (TS codec == on-chain layout)", () => {
  const r: ReconciliationRecord = {
    status: SettlementStatus.Settled,
    nonce: 1n,
    calHash: 0x8d4b96e6n,
    txHash: 0xa8d5863an,
    observedEffectHash: 0xca2f3bn,
    updatedAt: 1_749_000_000,
  };
  const back = parseRecordCell(buildRecordCell(r));
  assert.deepEqual(back, r, "record must survive a build→parse round-trip");
});

test("SC-1: every stored status code round-trips", () => {
  for (const status of [
    SettlementStatus.Settled,
    SettlementStatus.Missing,
    SettlementStatus.Delayed,
    SettlementStatus.Mismatch,
  ]) {
    const r: ReconciliationRecord = { status, nonce: 7n, calHash: 1n, txHash: 0n, observedEffectHash: 0n, updatedAt: 0 };
    assert.equal(parseRecordCell(buildRecordCell(r)).status, status);
  }
});

test("SC-1: status outside the stored range 1..4 is rejected", () => {
  const bad: ReconciliationRecord = { status: SettlementStatus.Unknown, nonce: 0n, calHash: 0n, txHash: 0n, observedEffectHash: 0n, updatedAt: 0 };
  assert.throws(() => buildRecordCell(bad), /status out of stored range/);
});

test("SC-1: upsert body carries op + key + record-ref", () => {
  const r: ReconciliationRecord = { status: SettlementStatus.Settled, nonce: 1n, calHash: 9n, txHash: 0n, observedEffectHash: 0n, updatedAt: 1 };
  const body = buildUpsertBody(0xdeadbeefn, r).beginParse();
  assert.equal(body.loadUint(32), 0x52454301, "op = OP_UPSERT_RECORD");
  assert.equal(body.loadUintBig(256), 0xdeadbeefn, "external_message_hash key");
  assert.equal(parseRecordCell(body.loadRef()).status, SettlementStatus.Settled, "record rides in a ref");
});
