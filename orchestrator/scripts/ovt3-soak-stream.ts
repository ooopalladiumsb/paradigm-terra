/**
 * OVT-3 (H3.2 / H3.3) — CONTINUOUS cross-language parity under sustained load.
 *
 * The golden vectors prove TS == Go on a handful of hand-curated programs (point-wise
 * parity, a Freeze-Surface axiom). This script falsifies a *different* claim: that the
 * two runtimes could agree point-wise yet *drift* under a long, continuous, multi-agent
 * stream. It generates a large soak program with the OVT agent (real signed CALs +
 * the OVT-1-proven trace shape), folds it through the TS reference node, self-checks
 * (`verifyReplay`), then pins the program + the TS-produced roots so the Go node
 * (`orchestrator-go/cmd/soak`) re-folds the identical stream and must reproduce every
 * per-tick STATE_ROOT, the per-tick global Merkle root, the final root, the event
 * count, and a SHA-256 over the whole canonical event log — byte-for-byte, 0 divergences.
 *
 *   SOAK_TICKS=120 SOAK_AGENTS=40 node --import tsx scripts/ovt3-soak-stream.ts   # from orchestrator/
 *
 * Above the Freeze Surface: it only *exercises* the proven node/validator/reducer over
 * a generated load; it does not touch normative code. The stream file is a regenerated
 * measurement artifact (gitignored) — what gets committed is this harness, the Go
 * verifier, and the recorded result in docs/notes/operational-validation-track.md.
 */

import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonical, type JcsValue } from "@paradigm-terra/canonical";
import { genesis } from "@paradigm-terra/cal-reducer";
import type { ExecutionTrace } from "@paradigm-terra/cal-validator";
import { run, verifyReplay, type Submission } from "../src/index.js";
import { OvtAgent, LocalTestOwnerSigner } from "../src/agent/ovt-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "soak-stream.json");

// Defaults favor CONTINUITY (many ticks) over width: the per-event STATE_ROOT cost
// grows with state size (≈ agent count), so a wide load gets expensive fast (that
// heavy re-hash constant is itself an OVT-SG finding). 150×8 keeps the default soak
// sub-minute while still being a long, multi-agent, continuous stream; crank
// SOAK_TICKS / SOAK_AGENTS for a heavier (hours-scale) run.
const TICKS = Number(process.env["SOAK_TICKS"] ?? 150);
const AGENTS = Number(process.env["SOAK_AGENTS"] ?? 8);
// Expiration must outlast the whole soak so every CAL is live at its tick (a clean
// finalizing load); the OVT agent defaults to 100, so for long soaks we lift it.
const EXPIRATION = BigInt(TICKS + 10);

// Distinct agents: each gets its own operator keypair (OvtAgent) + owner signer
// (LocalTestOwnerSigner generates its own ed25519 key) + a distinct workchain-0 agent id.
const agents = Array.from({ length: AGENTS }, (_, i) => {
  const id = "0:" + i.toString(16).padStart(64, "0");
  const owner = new LocalTestOwnerSigner();
  const agent = new OvtAgent(owner, { serverCmd: process.execPath, serverArgs: [], agentId: id }); // no MCP connect — fast mint
  return { id, owner, agent };
});

// Merged genesis: register + fund every agent (the node's provisioning, not the action).
const genesisState = (() => {
  const g = genesis() as Record<string, any>;
  for (const { id, owner, agent } of agents) {
    g.ptra.balances[id] = 10n ** 18n;
    g.registry.agents[id] = {
      granted_scopes: ["ton_transfer"],
      operator_pubkey: agent.operatorPubkeyHex(),
      owner_pubkey: owner.ownerPubkeyHex(),
    };
  }
  return g;
})();

// One finalizing CAL per agent per tick (nonce = tick+1; the previous tick's CAL
// finalized and cleared in_flight, so the agent's nonce monotonically advances).
const ticks: { tick: bigint; submissions: Submission[] }[] = [];
for (let t = 0; t < TICKS; t++) {
  const submissions: Submission[] = [];
  for (const { agent } of agents) {
    const { cal, trace } = await agent.mintSubmissionFast(BigInt(t + 1), BigInt(t), EXPIRATION);
    submissions.push({ cal, trace } as unknown as Submission);
  }
  ticks.push({ tick: BigInt(t), submissions });
}

console.log(`OVT-3 soak: generating ${TICKS} ticks × ${AGENTS} agents = ${TICKS * AGENTS} submissions …`);
const t0 = process.hrtime.bigint();
const transcript = run({ genesisState, ticks });
const runMs = Number(process.hrtime.bigint() - t0) / 1e6;

// --- TS self-consistency before we pin anything for Go ---
if (!verifyReplay(transcript)) {
  console.error("❌ TS verifyReplay failed — the soak transcript is not self-consistent; aborting.");
  process.exit(1);
}

// Every submission must FINALIZE — this is a healthy continuous load, not an error soak.
let finalized = 0;
let other = 0;
for (const tk of transcript.ticks) {
  for (const s of tk.submissions) {
    if (s.terminalStage === "FINALIZED") finalized++;
    else other++;
  }
}
if (other !== 0) {
  console.error(`❌ ${other} submission(s) did not FINALIZE — the soak load is not clean; aborting.`);
  process.exit(1);
}

// --- pin the stream + the TS-produced expectations for the Go verifier ---
function traceToJcs(t: ExecutionTrace): JcsValue {
  return {
    current_tick: t.currentTick,
    operator_sig_present: t.operatorSigPresent,
    owner_sig_present: t.ownerSigPresent,
    pinned_mcp_schema_hash: t.pinnedMcpSchemaHash ?? "",
    state_before: t.stateBefore as JcsValue,
    state_after: t.stateAfter as JcsValue,
    steps: t.steps.map((s): JcsValue => {
      const o: { [k: string]: JcsValue } = { ok: s.ok, effects: [...s.effects] as JcsValue[] };
      if (s.errorDetail !== undefined) o["error_detail"] = s.errorDetail;
      return o;
    }),
  };
}

// SHA-256 over the concatenation of every event's canonical serialization. Canonical
// encoding is byte-identical across runtimes (proven), so Go computes the same digest
// only if it produced the same event log in the same order — full event-log parity
// without shipping ~half a million event strings.
const eventLogHash = crypto.createHash("sha256");
for (const ev of transcript.eventLog) eventLogHash.update(serializeCanonical(ev as unknown as JcsValue));
const eventLogSha256 = "0x" + eventLogHash.digest("hex");

const doc = {
  meta: {
    package: "@paradigm-terra/orchestrator",
    track: "OVT-3 / H3.2-H3.3 — continuous cross-language parity soak",
    ticks: TICKS,
    agents: AGENTS,
    submissions: TICKS * AGENTS,
    generated_at: new Date().toISOString(),
    note:
      "MEASUREMENT artifact (regenerate via scripts/repro.sh ovt3-soak), NOT a normative golden vector. " +
      "Pins a generated multi-agent stream + the TS reference roots so orchestrator-go/cmd/soak re-folds " +
      "the identical stream and must reproduce every root + the event-log SHA-256 with 0 divergences.",
  },
  start_state_canonical: serializeCanonical(transcript.genesisState as JcsValue),
  input_ticks: ticks.map((blk) => ({
    tick: blk.tick.toString(),
    submissions: blk.submissions.map((s) => ({
      cal_canonical: serializeCanonical(s.cal as JcsValue),
      trace_canonical: serializeCanonical(traceToJcs(s.trace)),
    })),
  })),
  expected: {
    final_state_root: transcript.finalStateRoot,
    event_count: transcript.eventLog.length,
    event_log_sha256: eventLogSha256,
    ticks: transcript.ticks.map((tk) => ({
      tick: tk.tick.toString(),
      state_root: tk.stateRoot,
      global_merkle_root: tk.globalMerkleRoot,
    })),
  },
};

await writeFile(OUTPUT_PATH, JSON.stringify(doc) + "\n", "utf8");

console.log(
  `✅ TS reference soak: ${finalized} FINALIZED over ${TICKS} ticks × ${AGENTS} agents ` +
    `(${transcript.eventLog.length} events, ${runMs.toFixed(0)} ms), verifyReplay OK.`,
);
console.log(`   final_state_root  = ${transcript.finalStateRoot}`);
console.log(`   event_log_sha256  = ${eventLogSha256}`);
console.log(`   pinned stream → ${OUTPUT_PATH}`);
console.log(`   next: (cd ../orchestrator-go && go run ./cmd/soak) to verify Go parity over the identical stream.`);
