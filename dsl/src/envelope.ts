/**
 * Versioned expression envelope (Constraint DSL v1.1 §9, DSL v1.2 §8.2).
 *
 *   { "dsl_version": "1.1" | "1.2", "expr": { ...AST... } }
 *
 * A CAL may mix v1.1 and v1.2 expressions; each carries its own version and
 * MUST be evaluated under that version's semantics.
 */

import type { DslVersion } from "./ast.js";
import { parseError, validationError } from "./errors.js";

export interface Envelope {
  readonly version: DslVersion;
  readonly expr: unknown;
}

/** Parse and validate a `{dsl_version, expr}` envelope. */
export function parseEnvelope(input: unknown): Envelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw parseError("MALFORMED_ENVELOPE", `envelope must be an object`);
  }
  const o = input as Record<string, unknown>;
  const version = o["dsl_version"];
  if (version !== "1.1" && version !== "1.2") {
    throw validationError("UNSUPPORTED_VERSION", `dsl_version must be "1.1" or "1.2", got ${JSON.stringify(version)}`);
  }
  if (!("expr" in o)) {
    throw parseError("MALFORMED_ENVELOPE", `envelope is missing "expr"`);
  }
  return { version: version as DslVersion, expr: o["expr"] };
}
