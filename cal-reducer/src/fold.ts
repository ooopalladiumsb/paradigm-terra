/**
 * Folding the Event Log into State (reducer design §8, CAL Spec §3.3).
 *
 *   materialize(events) = events.fold(genesis, apply)
 *   snapshot(tick)      = materialize(events_up_to(tick - 1))   (validator-side)
 */

import { apply, type ApplyResult } from "./apply.js";
import { genesis, stateRootOf, type Json, type State } from "./state.js";

export type FoldResult =
  | { ok: true; state: State }
  | { ok: false; code: string; index: number };

/** Fold an ordered event sequence into State from `start` (default genesis). */
export function materialize(events: readonly { [k: string]: Json }[], start: State = genesis()): FoldResult {
  let state = start;
  for (let i = 0; i < events.length; i++) {
    const res: ApplyResult = apply(state, events[i]!);
    if (!res.ok) return { ok: false, code: res.code, index: i };
    state = res.state;
  }
  return { ok: true, state };
}

/** STATE_ROOT (hex) after each event, stopping at the first ApplyError. */
export function scanStateRoots(
  events: readonly { [k: string]: Json }[],
  start: State = genesis(),
): { roots: string[]; error?: { code: string; index: number } } {
  const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
  const roots: string[] = [];
  let state = start;
  for (let i = 0; i < events.length; i++) {
    const res = apply(state, events[i]!);
    if (!res.ok) return { roots, error: { code: res.code, index: i } };
    state = res.state;
    roots.push(toHex(stateRootOf(state)));
  }
  return { roots };
}
