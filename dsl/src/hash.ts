/**
 * DSL expression hashing (Constraint DSL v1.1 §4, DSL v1.2 §8.1).
 *
 *   DSL_HASH = SHA256("PARADIGM_TERRA_DSL_V1.x" || canonical_json(expression))
 *
 * The hash is taken over the canonical JSON of the expression AST itself (the
 * `expr`, not the `{dsl_version, expr}` envelope). The domain tag differs
 * between versions so identical AST text under v1.1 and v1.2 hashes differently
 * (cache invalidation, DSL v1.2 §8.3). Canonicalization and domain separation
 * are delegated to the canonical layer, so DSL hashes are byte-identical to the
 * encoding spec's restricted-JCS profile.
 */

import { canonicalizeValue, DOMAIN_TAGS, domainHash } from "@paradigm-terra/canonical";
import type { DslVersion } from "./ast.js";

export function dslDomainTag(version: DslVersion): string {
  return version === "1.2" ? DOMAIN_TAGS.DSL_V1_2 : DOMAIN_TAGS.DSL_V1_1;
}

/** Compute the DSL_HASH of an expression AST under the given DSL version. */
export function dslHash(expr: unknown, version: DslVersion): Uint8Array {
  return domainHash(dslDomainTag(version), canonicalizeValue(expr));
}
