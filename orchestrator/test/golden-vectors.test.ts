/**
 * Golden-vector regression: re-running each shared program through the node must
 * reproduce the stored event log, per-tick STATE_ROOT + global Merkle root, per
 * submission terminal stage / reason / per-event roots, and the final root. The
 * port (Rust/Go) will reproduce the same golden from the stored canonical inputs.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { serializeCanonical, type JcsValue } from "@paradigm-terra/canonical";
import { run } from "../src/index.js";
import { PROGRAMS } from "../scripts/programs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(__dirname, "..", "vectors", "golden.json"), "utf8")) as {
  programs: Array<{
    id: string;
    expected: {
      event_log: string[];
      final_state_root: string;
      ticks: Array<{
        tick: string;
        state_root: string;
        global_merkle_root: string;
        submissions: Array<{ cal_hash: string; agent_id: string; terminal_stage: string | null; reason_code: string | null; event_types: string[]; state_roots: string[] }>;
      }>;
    };
  }>;
};

test("golden programs reproduce byte-for-byte", () => {
  assert.equal(golden.programs.length, PROGRAMS.length);
  for (let i = 0; i < PROGRAMS.length; i++) {
    const { id, program } = PROGRAMS[i]!;
    const g = golden.programs[i]!;
    assert.equal(g.id, id, "program id/order");

    const t = run(program);
    assert.deepEqual(t.eventLog.map((e) => serializeCanonical(e as JcsValue)), g.expected.event_log, `${id}: event log`);
    assert.equal(t.finalStateRoot, g.expected.final_state_root, `${id}: final state root`);
    assert.equal(t.ticks.length, g.expected.ticks.length, `${id}: tick count`);

    for (let k = 0; k < t.ticks.length; k++) {
      const tk = t.ticks[k]!;
      const gk = g.expected.ticks[k]!;
      assert.equal(tk.tick.toString(), gk.tick, `${id} tick[${k}]: tick`);
      assert.equal(tk.stateRoot, gk.state_root, `${id} tick[${k}]: state root`);
      assert.equal(tk.globalMerkleRoot, gk.global_merkle_root, `${id} tick[${k}]: global Merkle root`);
      assert.equal(tk.submissions.length, gk.submissions.length, `${id} tick[${k}]: submission count`);
      for (let j = 0; j < tk.submissions.length; j++) {
        const s = tk.submissions[j]!;
        const gs = gk.submissions[j]!;
        assert.equal(s.calHash, gs.cal_hash, `${id} tick[${k}] sub[${j}]: cal hash`);
        assert.equal(s.terminalStage, gs.terminal_stage, `${id} tick[${k}] sub[${j}]: terminal stage`);
        assert.equal(s.reasonCode, gs.reason_code, `${id} tick[${k}] sub[${j}]: reason code`);
        assert.deepEqual(s.events.map((e) => e["event_type"]), gs.event_types, `${id} tick[${k}] sub[${j}]: event types`);
        assert.deepEqual([...s.stateRoots], gs.state_roots, `${id} tick[${k}] sub[${j}]: per-event state roots`);
      }
    }
  }
});
