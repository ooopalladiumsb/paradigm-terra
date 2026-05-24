/**
 * Golden-vector verification for the CAL skeleton. Re-runs every vector in
 * vectors/golden.json and asserts the validation outcome, CAL_HASH, canonical
 * unsigned bytes, and event/receipt hashes. The Rust/Go ports must match this.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseCanonical, toHex } from "@paradigm-terra/canonical";
import { calHash, canonicalUnsignedBytes, checkCal, eventHash, receiptHash } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(__dirname, "..", "vectors", "golden.json"), "utf8"));

test("golden CAL vectors: validation outcome + hashes reproduce", () => {
  assert.ok(Array.isArray(golden.cals) && golden.cals.length >= 11);
  for (const v of golden.cals) {
    const cal = parseCanonical(v.cal_canonical);
    const res = checkCal(cal);
    assert.equal(res.valid, v.output.valid, `${v.id}: valid`);
    assert.equal(res.code ?? undefined, v.output.code ?? undefined, `${v.id}: code`);
    assert.equal(res.detail ?? undefined, v.output.detail ?? undefined, `${v.id}: detail`);
    if (v.output.valid) {
      assert.equal(`0x${toHex(calHash(cal))}`, v.output.cal_hash, `${v.id}: cal_hash`);
      assert.equal(`0x${toHex(canonicalUnsignedBytes(cal))}`, v.output.unsigned_bytes_hex, `${v.id}: unsigned bytes`);
    }
  }
});

test("golden event vectors: event/receipt hashes reproduce", () => {
  assert.ok(Array.isArray(golden.events) && golden.events.length >= 2);
  for (const e of golden.events) {
    const ev = parseCanonical(e.event_canonical);
    assert.equal(`0x${toHex(eventHash(ev))}`, e.output.event_hash, `${e.id}: event_hash`);
    assert.equal(`0x${toHex(receiptHash(ev))}`, e.output.receipt_hash, `${e.id}: receipt_hash`);
  }
});
