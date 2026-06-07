// PR-1.2c-A — snapshot format + codec. The STORAGE ARTIFACT only: serialise / deserialise an
// IncrementalState into a self-checking on-disk envelope. NO replay, NO recovery, NO daemon wiring —
// those are PR-1.2c-B/C. Operations layer, above the Freeze Surface.
//
// A snapshot is a discardable recovery accelerator, never a source of truth (Rule 1): the WAL is the
// only commit authority and `snapshot + tail WAL → truth`. This file proves only that the artifact
// round-trips exactly — the single claim of Gate A:
//
//   decode(encode(x)) == x   for x = { state, currentTick, eventCount, lastEventHash }
//
// with `lastEventHash` (Uint8Array) preserved BYTE-FOR-BYTE. That is the exact false positive the
// memory-only `structuredClone` round-trip in PR-1.2b could not catch: a plain JSON pass turns a
// Uint8Array into `{"0":..,"1":..}` or `{}`, so STATE_ROOT + eventCount would match while
// lastEventHash is silently destroyed. The codec below tags both `bigint` and `Uint8Array` explicitly.

import { fromHex, sha256, toHex } from "@paradigm-terra/canonical";
import { incrementalGlobalRoot, incrementalStateRoot, type IncrementalState } from "../index.js";

export const SNAPSHOT_VERSION = 1;

export class SnapshotCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotCorruptionError";
  }
}

/** The persisted snapshot body: the IncrementalState plus the metadata to validate it on load. The
 *  roots are redundant (derivable from `incr`) — a fast integrity cross-check, not a second truth. */
export interface SnapshotBody {
  readonly snapshot_version: number;
  /** WAL tick index this snapshot folds THROUGH (inclusive). Tail = WAL ticks after it (PR-1.2c-B). */
  readonly covered_tick: bigint;
  readonly state_root: string; // hex 0x — = incrementalStateRoot(incr)
  readonly event_log_root: string; // hex 0x — = incrementalGlobalRoot(incr) (CE §6.3)
  readonly incr: IncrementalState;
}

// --- value codec: bigint ($bigint) AND Uint8Array ($bytes hex) -----------------------------------
const BIGINT_TAG = "$bigint";
const BYTES_TAG = "$bytes";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { [BIGINT_TAG]: value.toString() };
  if (value instanceof Uint8Array) return { [BYTES_TAG]: toHex(value) };
  return value;
}
function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && typeof o[BIGINT_TAG] === "string") return BigInt(o[BIGINT_TAG] as string);
    if (keys.length === 1 && typeof o[BYTES_TAG] === "string") return fromHex(o[BYTES_TAG] as string);
  }
  return value;
}

const utf8 = new TextEncoder();

/** Assemble a snapshot body from live state and the WAL tick it covers (roots filled from `incr`). */
export function makeSnapshotBody(incr: IncrementalState, coveredTick: bigint): SnapshotBody {
  return {
    snapshot_version: SNAPSHOT_VERSION,
    covered_tick: coveredTick,
    state_root: incrementalStateRoot(incr),
    event_log_root: incrementalGlobalRoot(incr),
    incr,
  };
}

/** Encode a snapshot body to its on-disk string: `{checksum, body}` where `body` is the exact JSON
 *  string the checksum is computed over (so verification is byte-exact, not re-serialisation-order
 *  dependent). */
export function encodeSnapshot(body: SnapshotBody): string {
  const bodyJson = JSON.stringify(body, replacer);
  const checksum = toHex(sha256(utf8.encode(bodyJson)), true);
  return JSON.stringify({ checksum, body: bodyJson });
}

/** Decode + verify a snapshot string. Throws SnapshotCorruptionError on a malformed envelope, a
 *  checksum mismatch (the discardable case — caller falls back per Rule 1), or an unsupported version.
 *  (The ahead-of-WAL hard-abort lives at the recovery layer, PR-1.2c-B, where the WAL is in scope.) */
export function decodeSnapshot(text: string): SnapshotBody {
  let outer: { checksum?: unknown; body?: unknown };
  try {
    outer = JSON.parse(text) as { checksum?: unknown; body?: unknown };
  } catch {
    throw new SnapshotCorruptionError("snapshot is not valid JSON");
  }
  if (typeof outer.body !== "string" || typeof outer.checksum !== "string") {
    throw new SnapshotCorruptionError("malformed snapshot envelope (missing checksum/body)");
  }
  const recomputed = toHex(sha256(utf8.encode(outer.body)), true);
  if (recomputed !== outer.checksum) {
    throw new SnapshotCorruptionError(`snapshot checksum mismatch (expected ${outer.checksum}, recomputed ${recomputed})`);
  }
  let body: SnapshotBody;
  try {
    body = JSON.parse(outer.body, reviver) as SnapshotBody;
  } catch {
    throw new SnapshotCorruptionError("snapshot body is not valid JSON after checksum passed");
  }
  if (body.snapshot_version !== SNAPSHOT_VERSION) {
    throw new SnapshotCorruptionError(`unsupported snapshot_version ${String(body.snapshot_version)} (this build: ${SNAPSHOT_VERSION})`);
  }
  return body;
}
