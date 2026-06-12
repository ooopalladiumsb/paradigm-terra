/**
 * PFC2-M8-R1 — PP#4 offline proof (Framing B), OFFLINE / no network. Asserts that a quorum-authorized
 * treasury.transfer (real Contract-A owner envelopes) finalizes and commits its effect through the real
 * orchestrator path (→ the anchor STATE_ROOT), while the sub-threshold twin is rejected QUORUM_NOT_MET
 * and commits nothing. The anchor STATE_ROOT is deterministic (fixed owner seeds), so PP#4-B has a stable
 * payload to broadcast. No testnet interaction here — the broadcast is the gated PP#4-B step.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPp4Proof } from "../scripts/pp4-plan.js";

test("PP#4-R1: quorum-authorized treasury.transfer → FINALIZED, effect commits, anchor root produced", () => {
  const { quorumPass } = buildPp4Proof();
  assert.equal(quorumPass.terminalStage, "FINALIZED");
  assert.equal(quorumPass.reasonCode, null);
  assert.equal(quorumPass.counterCommitted, true, "the transfer effect commits to consensus state");
  assert.match(quorumPass.anchorRoot, /^0x[0-9a-f]{64}$/, "a 32-byte STATE_ROOT (the anchor payload)");
});

test("PP#4-R1: sub-threshold twin → QUORUM_NOT_MET, no effect committed", () => {
  const { subThreshold } = buildPp4Proof();
  assert.equal(subThreshold.terminalStage, "FAILED");
  assert.equal(subThreshold.reasonCode, "QUORUM_NOT_MET");
  assert.equal(subThreshold.counterCommitted, false, "the rejected CAL commits no transfer");
});

test("PP#4-R1: the anchor STATE_ROOT is deterministic (fixed owner seeds) — a stable PP#4-B payload", () => {
  const a = buildPp4Proof().quorumPass.anchorRoot;
  const b = buildPp4Proof().quorumPass.anchorRoot;
  assert.equal(a, b, "two offline runs produce the same anchor root");
});
