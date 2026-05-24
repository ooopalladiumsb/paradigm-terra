/**
 * Constitutionally injected Bounded-Mode invariants (DSL v1.2 §7.1, CAL §10.3).
 *
 * When `state.failure_mode.is_bounded_mode == true` at VALIDATED time, the
 * runtime injects this exact set on top of whatever invariants the CAL declares.
 * The set is deterministically derived by every validator from the flag alone,
 * so it is NOT part of the CAL hash but IS part of consensus (DSL v1.2 §7.2).
 *
 * The expressions below are reproduced verbatim from DSL v1.2 §7.1 as
 * restricted-JCS values, suitable for evaluation (scope: invariant) and for
 * hashing via `dslHash(expr, "1.2")`.
 */

/** The three injected emergency invariants, in canonical declaration order. */
export const EMERGENCY_INVARIANTS: readonly unknown[] = [
  {
    op: "gte",
    lhs: { var: "state.after.treasury.developer_fund_balance" },
    rhs: { var: "state.before.treasury.developer_fund_balance" },
  },
  {
    op: "gte",
    lhs: { var: "state.after.treasury.nav" },
    rhs: {
      op: "sub",
      lhs: { var: "state.before.treasury.nav" },
      rhs: { const: 0n },
    },
  },
  {
    op: "eq",
    lhs: { var: "state.after.failure_mode.is_bounded_mode" },
    rhs: { const: true },
  },
];

/**
 * Return the effective invariant set for a CAL: the declared invariants with the
 * emergency set appended when the system is in Bounded Mode (DSL v1.2 §7.1).
 */
export function effectiveInvariants(declared: readonly unknown[], isBoundedMode: boolean): unknown[] {
  return isBoundedMode ? [...declared, ...EMERGENCY_INVARIANTS] : [...declared];
}
