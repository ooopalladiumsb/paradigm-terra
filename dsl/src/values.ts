/**
 * Runtime value model and the DSL type system (Constraint DSL v1.1 §2).
 *
 * Values are produced from two sources: `{const: ...}` literals (typed at parse
 * time, see parse.ts) and variable lookups into the bound state/params (typed
 * here by `materialize`). String, address and NFC handling delegate to the
 * canonical layer so the DSL is byte-for-byte aligned with the encoding spec
 * (and inherits the Unicode 15.1 assigned-set pin that keeps NFC parity across
 * the TS / Rust / Go implementations).
 */

import {
  assertAssigned,
  isCanonicalAddress,
  toHex,
  utf8NfcBytes,
} from "@paradigm-terra/canonical";
import type { ConstType } from "./ast.js";
import { runtimeError, validationError } from "./errors.js";

export const INT256_MIN = -(2n ** 255n);
export const INT256_MAX = 2n ** 255n - 1n;

export function inInt256Range(v: bigint): boolean {
  return v >= INT256_MIN && v <= INT256_MAX;
}

export type Value =
  | { readonly kind: "int256"; readonly int: bigint }
  | { readonly kind: "bool"; readonly bool: boolean }
  | { readonly kind: "string"; readonly str: string }
  | { readonly kind: "bytes32"; readonly hex: string }
  | { readonly kind: "address"; readonly addr: string }
  | { readonly kind: "list"; readonly items: readonly Value[] }
  | { readonly kind: "map"; readonly entries: ReadonlyMap<string, Value> }
  | { readonly kind: "null" };

export type ValueKind = Value["kind"];

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Classify a JSON string literal into its DSL scalar type (DSL v1.1 §2):
 * a canonical raw TON address, a 0x-prefixed 32-byte hash, or a plain string.
 */
export function classifyString(s: string): "address" | "bytes32" | "string" {
  if (isCanonicalAddress(s)) return "address";
  if (BYTES32_RE.test(s)) return "bytes32";
  return "string";
}

/** Build a string value, enforcing the assigned-set pin and storing NFC form. */
export function makeString(s: string): Value {
  try {
    assertAssigned(s);
  } catch {
    throw runtimeError("STRING_UNASSIGNED", `string contains code point outside the Unicode 15.1 assigned set`);
  }
  return { kind: "string", str: s.normalize("NFC") };
}

export function makeBytes32(s: string): Value {
  if (!BYTES32_RE.test(s)) {
    throw validationError("BYTES32_MALFORMED", `bytes32 must be 0x + 64 hex digits, got ${JSON.stringify(s)}`);
  }
  return { kind: "bytes32", hex: `0x${s.slice(2).toLowerCase()}` };
}

export function makeAddress(s: string): Value {
  if (!isCanonicalAddress(s)) {
    throw validationError("ADDRESS_NONCANONICAL", `address must be canonical workchain:hex256, got ${JSON.stringify(s)}`);
  }
  return { kind: "address", addr: s };
}

export function makeInt256(v: bigint): Value {
  if (!inInt256Range(v)) {
    throw validationError("INT256_RANGE", `integer ${v} is outside the int256 range`);
  }
  return { kind: "int256", int: v };
}

/** Construct the runtime value for a typed `{const}` literal. */
export function constValue(constType: ConstType, value: bigint | boolean | string | null): Value {
  switch (constType) {
    case "int256":
      return makeInt256(value as bigint);
    case "bool":
      return { kind: "bool", bool: value as boolean };
    case "string":
      return makeString(value as string);
    case "bytes32":
      return makeBytes32(value as string);
    case "address":
      return makeAddress(value as string);
    case "null":
      return { kind: "null" };
  }
}

/**
 * Materialize a value read from bound state/params (a restricted-JCS value) into
 * a typed DSL Value. JSON arrays → list, JSON objects → map, integers → int256,
 * strings classified by `classifyString`. Lists/maps come only from bindings,
 * never from literals (DSL v1.1 §2).
 */
export function materialize(j: unknown): Value {
  if (j === null) return { kind: "null" };
  if (typeof j === "boolean") return { kind: "bool", bool: j };
  if (typeof j === "bigint") return makeInt256(j);
  if (typeof j === "number") {
    if (!Number.isInteger(j)) {
      throw runtimeError("NON_INTEGER", `non-integer number ${j} is not representable in the DSL`);
    }
    return makeInt256(BigInt(j));
  }
  if (typeof j === "string") {
    switch (classifyString(j)) {
      case "address":
        return makeAddress(j);
      case "bytes32":
        return makeBytes32(j);
      case "string":
        return makeString(j);
    }
  }
  if (Array.isArray(j)) {
    return { kind: "list", items: j.map((e) => materialize(e)) };
  }
  if (typeof j === "object") {
    const entries = new Map<string, Value>();
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      entries.set(k, materialize(v));
    }
    return { kind: "map", entries };
  }
  throw runtimeError("UNREPRESENTABLE", `value of type ${typeof j} cannot be materialized`);
}

/**
 * Canonical string form of a value when used as a map key for `contains_key`
 * (DSL v1.1 §3.1). Only string-representable kinds are valid keys; others throw
 * a type violation handled by the caller.
 */
export function keyForm(v: Value): string {
  switch (v.kind) {
    case "string":
      return v.str;
    case "address":
      return v.addr;
    case "bytes32":
      return v.hex;
    default:
      throw validationError("KEY_TYPE", `value of kind ${v.kind} cannot be used as a map key`);
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Structural equality (DSL v1.1 §3.3). Returns a boolean, or throws a type
 * violation when two non-null operands have incompatible kinds (mixed types are
 * permitted only with `null`).
 */
export function valuesEqual(a: Value, b: Value): boolean {
  if (a.kind === "null" || b.kind === "null") {
    return a.kind === "null" && b.kind === "null";
  }
  if (a.kind !== b.kind) {
    throw validationError("TYPE_MISMATCH", `cannot compare ${a.kind} with ${b.kind}`);
  }
  switch (a.kind) {
    case "int256":
      return a.int === (b as typeof a).int;
    case "bool":
      return a.bool === (b as typeof a).bool;
    case "string":
      return bytesEqual(utf8NfcBytes(a.str), utf8NfcBytes((b as typeof a).str));
    case "bytes32":
      return a.hex === (b as typeof a).hex;
    case "address":
      return a.addr === (b as typeof a).addr;
    case "list": {
      const bl = (b as typeof a).items;
      if (a.items.length !== bl.length) return false;
      for (let i = 0; i < a.items.length; i++) {
        if (!valuesEqual(a.items[i]!, bl[i]!)) return false;
      }
      return true;
    }
    case "map": {
      const be = (b as typeof a).entries;
      if (a.entries.size !== be.size) return false;
      for (const [k, v] of a.entries) {
        const other = be.get(k);
        if (other === undefined) return false;
        if (!valuesEqual(v, other)) return false;
      }
      return true;
    }
  }
}

/** Human-readable kind for diagnostics (also used in golden-vector dumps). */
export function describe(v: Value): string {
  switch (v.kind) {
    case "int256":
      return `int256(${v.int})`;
    case "bool":
      return `bool(${v.bool})`;
    case "string":
      return `string(0x${toHex(utf8NfcBytes(v.str))})`;
    case "bytes32":
      return `bytes32(${v.hex})`;
    case "address":
      return `address(${v.addr})`;
    case "list":
      return `list[${v.items.length}]`;
    case "map":
      return `map{${v.entries.size}}`;
    case "null":
      return "null";
  }
}
