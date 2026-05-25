/**
 * Golden-vector verification for the reducer. Replays every sequence from its
 * start state and asserts the per-event STATE_ROOT, the genesis root, and the
 * ApplyError codes. The Rust/Go parity ports must match this.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseCanonical, toHex } from "@paradigm-terra/canonical";
import { apply, genesis, scanStateRoots, stateRootOf, type Json, type State } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(__dirname, "..", "vectors", "golden.json"), "utf8"));

const parseState = (text: string) => parseCanonical(text) as unknown as State;
const parseEvent = (text: string) => parseCanonical(text) as unknown as { [k: string]: Json };

test("genesis STATE_ROOT matches the pinned value", () => {
  assert.equal(`0x${toHex(stateRootOf(genesis()))}`, golden.genesis_state_root);
});

test("each sequence reproduces every per-event STATE_ROOT", () => {
  assert.ok(golden.sequences.length >= 3);
  for (const s of golden.sequences) {
    const start = parseState(s.start_state_canonical);
    const events = s.events.map(parseEvent);
    const scan = scanStateRoots(events, start);
    assert.equal(scan.error, undefined, `${s.id}: unexpected error ${JSON.stringify(scan.error)}`);
    assert.deepEqual(scan.roots, s.expected_roots, `${s.id}: roots`);
  }
});

test("each error case yields the pinned ApplyError code", () => {
  assert.ok(golden.errors.length >= 6);
  for (const e of golden.errors) {
    const start = parseState(e.start_state_canonical);
    const res = apply(start, parseEvent(e.event_canonical));
    assert.equal(res.ok, false, `${e.id}: expected failure`);
    if (!res.ok) assert.equal(res.code, e.expected_error_code, `${e.id}: code`);
  }
});
