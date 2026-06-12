/**
 * Reducer fault model (reducer design §7). `apply` is total: malformed or illegal
 * events yield a typed `ApplyError` (carried in the result), never an exception
 * at the public boundary. Codes are pinned by the golden vectors.
 */

export const APPLY_ERROR_CODES = [
  "DUPLICATE_CAL",
  "AGENT_BUSY",
  "UNKNOWN_CAL",
  "BAD_STAGE",
  "INSUFFICIENT_BALANCE",
  "UNDERFLOW",
  "OVERFLOW",
  "UNKNOWN_EVENT",
  "BAD_DELTA",
  "BAD_TICK",
  "BAD_OWNER_RECORD", // PFC2-M3: registry owners[]/threshold violates the §1.1 well-formed bounds
] as const;
export type ApplyErrorCode = (typeof APPLY_ERROR_CODES)[number];

export class ApplyError extends Error {
  override readonly name = "ApplyError";
  readonly code: ApplyErrorCode;
  constructor(code: ApplyErrorCode, detail?: string) {
    super(detail ? `[${code}] ${detail}` : `[${code}]`);
    this.code = code;
  }
}
