// PR-1.8 — live observer (closes H3.5-live). An EXTERNAL party tails a running node's directory and
// independently re-derives its root from the committed inputs, confirming the node's published head with
// NO involvement from the node. Strictly observe-only: it reads the dir (genesis + WAL + head.json) and
// writes nothing — "monitoring observes, consensus decides". The node owns the truth; the observer only
// re-checks it. The cross-language form (independent Go re-fold) is scripts/pr1-8-live-observer.mjs.

import fs from "node:fs";
import path from "node:path";
import { run } from "../index.js";
import { OvtNode } from "./persistent-node.js";

export type ObserverStatus = "OBSERVED_OK" | "OBSERVED_DRIFT" | "OBSERVED_EMPTY";

export interface ObserverVerdict {
  readonly status: ObserverStatus;
  /** Committed ticks the observer independently re-folded (= the node's published checkpoint length). */
  readonly observedTicks: number;
  /** The node's published checkpoint (head.json) vs the observer's independent re-derivation. */
  readonly claimedStateRoot: string;
  readonly derivedStateRoot: string;
  readonly claimedGlobalRoot: string;
  readonly derivedGlobalRoot: string;
}

interface Head {
  readonly tickCount: number;
  readonly finalStateRoot: string;
  readonly eventLogRoot: string;
}

/**
 * A read-only live observer. `observe(dir)` reads the node's published head and the durable WAL, folds
 * the WAL prefix up to the PUBLISHED tick count (so it verifies the node's own checkpoint and is robust
 * to the WAL-ahead-of-head write race — the observer is never ahead of the node), and compares its
 * independently-derived STATE_ROOT + global root to the head. It never writes to the node directory.
 */
export class LiveObserver {
  observe(dir: string): ObserverVerdict {
    const head = JSON.parse(fs.readFileSync(path.join(dir, "head.json"), "utf8")) as Head;
    const program = OvtNode.readProgram(dir);
    const claimedN = head.tickCount;
    if (claimedN === 0) {
      return { status: "OBSERVED_EMPTY", observedTicks: 0, claimedStateRoot: head.finalStateRoot, derivedStateRoot: "", claimedGlobalRoot: head.eventLogRoot, derivedGlobalRoot: "" };
    }
    // verify exactly the node's published checkpoint (the WAL may already hold later, not-yet-published
    // ticks — folding only the published prefix keeps the observer behind-or-equal, never ahead).
    const ticks = program.ticks.slice(0, claimedN);
    const t = run({ genesisState: program.genesisState, ticks });
    const derivedStateRoot = t.finalStateRoot;
    const derivedGlobalRoot = t.ticks.length > 0 ? t.ticks[t.ticks.length - 1]!.globalMerkleRoot : "";
    const ok = ticks.length === claimedN && derivedStateRoot === head.finalStateRoot && derivedGlobalRoot === head.eventLogRoot;
    return {
      status: ok ? "OBSERVED_OK" : "OBSERVED_DRIFT",
      observedTicks: ticks.length,
      claimedStateRoot: head.finalStateRoot,
      derivedStateRoot,
      claimedGlobalRoot: head.eventLogRoot,
      derivedGlobalRoot,
    };
  }
}
