/**
 * PP#4-B — the pinned anchor transport (box 3 of pp4-b-gate.md §2). Offline, no network.
 *
 * Asserts the STATE_ROOT anchor body encoding is deterministic and byte-stable: the same quorum-finalized
 * root always yields the same anchor cell (hash + BoC). This is the off-ramp guarantee for runbook §3
 * step 3 — the broadcast carries exactly these bytes, and step 5 reconstructs them to verify the on-chain
 * payload. Mirrors the PP#4 offline determinism check (anchor root 0x4a14…d4f0).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { beginCell } from "@ton/core";
import { ANCHOR_OP, AnchorBodyError, anchorBodyBoc, anchorBodyCell, parseAnchorRoot } from "../src/anchor-body.ts";

// The quorum-finalized STATE_ROOT proven offline (orchestrator/test/pp4-multisig-anchor.test.ts).
const ROOT = "0x4a14f8f11f37657e62aa6670822a18544fe1fea560aac17f16cd9234efc4d4f0";

// Pinned anchor body for ROOT — the exact bytes PP#4-B broadcasts. Any drift here is a pre-broadcast halt.
const PINNED_BODY_HASH = "0x79543a1b015462d0920125b5e41eb5c57f38b2f7d7a243fb689f13e5a103d0bc";
const PINNED_BODY_BOC_B64 = "te6cckEBAQEAJgAASFBUQTFKFPjxHzdlfmKqZnCCKhhUT+H+pWCqwX8WzZI078TU8AQJrCo=";

test("PP#4-B anchor: op tag is ASCII 'PTA1'", () => {
  assert.equal(ANCHOR_OP, 0x50544131);
  assert.equal(Buffer.from(ANCHOR_OP.toString(16), "hex").toString("ascii"), "PTA1");
});

test("PP#4-B anchor: body cell is deterministic for the proven root (hash + BoC pinned)", () => {
  const cell = anchorBodyCell(ROOT);
  assert.equal(cell.bits.length, 288, "op(32) + root(256) = 288 bits, single cell");
  assert.equal(`0x${cell.hash().toString("hex")}`, PINNED_BODY_HASH);
  assert.equal(anchorBodyBoc(ROOT), PINNED_BODY_BOC_B64);
});

test("PP#4-B anchor: round-trip recovers the exact root", () => {
  assert.equal(parseAnchorRoot(anchorBodyCell(ROOT)), ROOT);
});

test("PP#4-B anchor: parse asserts the op tag (rejects a foreign body)", () => {
  const foreign = beginCell().storeUint(0, 32).endCell(); // op 0 (text-comment tag), not PTA1
  assert.throws(() => parseAnchorRoot(foreign), (e) => e instanceof AnchorBodyError && e.code === "ANCHOR_BAD_OP");
});

test("PP#4-B anchor: malformed roots are rejected", () => {
  for (const bad of ["4a14", "0x4A14", `0x${"zz".repeat(32)}`, `0x${"00".repeat(31)}`, ""]) {
    assert.throws(() => anchorBodyCell(bad), (e) => e instanceof AnchorBodyError && e.code === "ANCHOR_BAD_ROOT", `should reject ${JSON.stringify(bad)}`);
  }
});
