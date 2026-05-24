/**
 * Error classes for the canonical layer.
 *
 * NoncanonicalEventError is the hard-validation error from CE v1.3 §9;
 * any condition that violates determinism (non-canonical JSON, invalid UTF-8,
 * dup keys, surrogates, fractional numbers) MUST raise it.
 */

export class NoncanonicalEventError extends Error {
  override readonly name = "NoncanonicalEventError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

export class CanonicalEncodingError extends Error {
  override readonly name = "CanonicalEncodingError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}
