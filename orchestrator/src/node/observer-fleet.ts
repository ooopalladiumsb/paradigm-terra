// A2-1 — observer fleet. Scales the PR-1.8 single LiveObserver into a quorum of INDEPENDENT tailers
// that each re-derive the node's published root and vote. The aggregate distinguishes the two failure
// modes one observer cannot: a wrong node (the whole quorum contradicts the claim → NODE_DRIFT) vs a
// wrong observer (a dissenter from the quorum → OBSERVER_SPLIT, isolated without blaming the node).
//
// Observe-only (PR-1.8 discipline): members read the node dir and write nothing; the fleet only reports.
// Members are INJECTABLE — the default is N LiveObserver re-folds; a real deployment plugs genuinely
// independent implementations/hosts (e.g. the Go re-fold, scripts/pr1-8-live-observer.mjs). No Freeze
// Surface impact: every root is re-derived from the frozen pipeline and merely compared here.

import { LiveObserver, type ObserverVerdict } from "./live-observer.js";

export type FleetStatus = "CONSENSUS_OK" | "NODE_DRIFT" | "OBSERVER_SPLIT" | "OBSERVED_EMPTY";

/** One independent tailer: re-derives the node's published roots from a directory. Injectable. */
export type FleetMember = (dir: string) => ObserverVerdict;

export interface FleetVerdict {
  readonly status: FleetStatus;
  readonly members: number;
  readonly quorum: number; // votes required to corroborate a root
  readonly agree: number; // members in the largest agreeing group
  readonly observedTicks: number;
  // the quorum's independently-derived roots vs the node's published (claimed) roots
  readonly quorumStateRoot: string;
  readonly quorumGlobalRoot: string;
  readonly claimedStateRoot: string;
  readonly claimedGlobalRoot: string;
  /** indices of members whose derived roots differ from the quorum (the isolated dissenters) */
  readonly dissenters: readonly number[];
}

/** A default fleet member: an independent PR-1.8 re-fold of the published checkpoint. */
export const liveObserverMember: FleetMember = (dir) => new LiveObserver().observe(dir);

export class ObserverFleet {
  private readonly members: FleetMember[];
  private readonly quorum: number;

  /**
   * @param members independent tailers (default: 3 LiveObserver re-folds).
   * @param opts.quorum votes required to corroborate a root (default: a strict majority, so the fleet
   *   tolerates up to ⌊(N-1)/2⌋ faulty observers and still reaches a verdict).
   */
  constructor(members?: FleetMember[], opts?: { quorum?: number }) {
    this.members = members && members.length > 0 ? members : [liveObserverMember, liveObserverMember, liveObserverMember];
    const majority = Math.floor(this.members.length / 2) + 1;
    this.quorum = opts?.quorum ?? majority;
    if (this.quorum < 1 || this.quorum > this.members.length) throw new Error(`invalid quorum ${this.quorum} for ${this.members.length} members`);
  }

  observe(dir: string): FleetVerdict {
    const verdicts = this.members.map((m) => m(dir));
    const N = verdicts.length;
    const claimedStateRoot = verdicts[0]!.claimedStateRoot;
    const claimedGlobalRoot = verdicts[0]!.claimedGlobalRoot;
    const base = {
      members: N,
      quorum: this.quorum,
      observedTicks: verdicts[0]!.observedTicks,
      claimedStateRoot,
      claimedGlobalRoot,
    };

    // a published-but-empty checkpoint: every honest member reports EMPTY.
    if (verdicts.every((v) => v.status === "OBSERVED_EMPTY")) {
      return { ...base, status: "OBSERVED_EMPTY", agree: N, quorumStateRoot: "", quorumGlobalRoot: "", dissenters: [] };
    }

    // group members by their independently-derived (state, global) root pair; the largest group votes.
    const key = (v: ObserverVerdict) => `${v.derivedStateRoot}|${v.derivedGlobalRoot}`;
    const groups = new Map<string, number[]>();
    verdicts.forEach((v, i) => {
      const k = key(v);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
    });
    let winner: number[] = [];
    for (const idxs of groups.values()) if (idxs.length > winner.length) winner = idxs;

    const agree = winner.length;
    const lead = verdicts[winner[0]!]!;
    const quorumStateRoot = lead.derivedStateRoot;
    const quorumGlobalRoot = lead.derivedGlobalRoot;
    const dissenters = verdicts.map((_, i) => i).filter((i) => !winner.includes(i));

    if (agree < this.quorum) {
      // no root reached quorum — the published state is ambiguous to the fleet (faulty tailers / torn read)
      return { ...base, status: "OBSERVER_SPLIT", agree, quorumStateRoot, quorumGlobalRoot, dissenters };
    }
    const corroboratesNode = quorumStateRoot === claimedStateRoot && quorumGlobalRoot === claimedGlobalRoot;
    if (!corroboratesNode) {
      // the quorum of independent witnesses derived a root different from the node's claim → the node is wrong
      return { ...base, status: "NODE_DRIFT", agree, quorumStateRoot, quorumGlobalRoot, dissenters };
    }
    // quorum corroborates the node; if any member dissented, it is a faulty observer (isolated), not the node
    return { ...base, status: dissenters.length === 0 ? "CONSENSUS_OK" : "OBSERVER_SPLIT", agree, quorumStateRoot, quorumGlobalRoot, dissenters };
  }
}
