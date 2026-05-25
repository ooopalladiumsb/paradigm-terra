/**
 * Protocol State model + genesis + STATE_ROOT (CAL Spec §7.3, reducer design §3).
 *
 * State is the canonical-JSON map of the eight namespaces. Internally we key it
 * by the short namespace name (`cal`, `ptra`, …); the §7.3 leaf uses the full
 * `state.<name>` form, applied in `stateRootOf`. Integers are bigint; STATE_ROOT
 * is computed by the canonical layer (already NORMATIVE), so the reducer never
 * reimplements §7.3.
 */

import { canonicalizeValue, stateRoot } from "@paradigm-terra/canonical";

/** JSON value as produced/consumed by the canonical layer. */
export type Json = null | boolean | bigint | string | Json[] | { [k: string]: Json };

/** The eight namespaces, in the §7.3 UTF-8-sorted order (by `state.<name>`). */
export const NAMESPACES = [
  "cal",
  "failure_mode",
  "governance",
  "oracles",
  "ptra",
  "registry",
  "tick",
  "treasury",
] as const;

export type State = { [k: string]: Json };

/** The fixed genesis state. Its STATE_ROOT is pinned by the golden vectors. */
export function genesis(): State {
  return {
    cal: { in_flight: {}, nonces: {} },
    failure_mode: { is_bounded_mode: false, capture_guard_counters: {} },
    governance: { gas_price_nano_ptra_per_unit: 1000n, genesis_validator_set: [], params: {} },
    oracles: { feeds: {} },
    ptra: { balances: {} },
    registry: { agents: {}, mcp_schema_hash: `0x${"00".repeat(32)}` },
    tick: { current: 0n },
    treasury: { nav: 0n, developer_fund_balance: 0n, collected_fees_window: 0n },
  };
}

/** STATE_ROOT over the eight namespaces (CAL Spec §7.3). */
export function stateRootOf(state: State): Uint8Array {
  return stateRoot(
    NAMESPACES.map((n) => ({ name: `state.${n}`, canonicalBytes: canonicalizeValue(state[n]) })),
  );
}

function isPlainObject(v: Json | undefined): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a value at a dotted path; `undefined` if any segment is missing. */
export function getIn(obj: Json | undefined, path: readonly string[]): Json | undefined {
  let cur: Json | undefined = obj;
  for (const seg of path) {
    if (!isPlainObject(cur) || !(seg in cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Immutably set a value at a path, cloning only along the path. */
export function setIn(obj: Json | undefined, path: readonly string[], value: Json): Json {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string, ...string[]];
  const base = isPlainObject(obj) ? obj : {};
  return { ...base, [head]: setIn(base[head], rest, value) };
}

/** Immutably delete the key at a path (no-op if absent). */
export function deleteIn(obj: Json | undefined, path: readonly string[]): Json {
  if (!isPlainObject(obj)) return obj ?? {};
  if (path.length === 1) {
    const { [path[0]!]: _drop, ...rest } = obj;
    return rest;
  }
  const [head, ...rest] = path as [string, ...string[]];
  if (!(head in obj)) return obj;
  return { ...obj, [head]: deleteIn(obj[head], rest) };
}
