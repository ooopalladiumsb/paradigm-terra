/**
 * Structural-validation error for the CAL skeleton.
 *
 * The CAL skeleton validates only what is decidable from the blob alone (no
 * state, no crypto). `code` is a stable, machine-comparable reason that the
 * golden vectors pin across the TS / Rust / Go implementations; `detail`
 * carries human context (e.g. which field, or the nested DSL reason) and, when
 * present, is ALSO pinned by the vectors so the ports reproduce it exactly.
 */

export class CalError extends Error {
  override readonly name = "CalError";
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, detail?: string) {
    super(detail ? `[${code}] ${detail}` : `[${code}]`);
    this.code = code;
    this.detail = detail;
  }
}

export function calError(code: string, detail?: string): CalError {
  return new CalError(code, detail);
}
