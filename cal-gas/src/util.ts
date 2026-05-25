/** Shared JSON value type + read helpers for the gas layer. */

export type Json = null | boolean | bigint | string | Json[] | { [k: string]: Json };

function isObj(v: Json | undefined): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a value at a dotted path; `undefined` if any segment is missing. */
export function getIn(obj: Json | undefined, path: readonly string[]): Json | undefined {
  let cur: Json | undefined = obj;
  for (const seg of path) {
    if (!isObj(cur) || !(seg in cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Read an integer field, defaulting when absent/non-integer. */
export function asBig(v: Json | undefined, def: bigint): bigint {
  return typeof v === "bigint" ? v : def;
}
