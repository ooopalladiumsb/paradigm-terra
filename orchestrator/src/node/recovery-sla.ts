// PR-1.3-B — recovery SLA cost model + cadence policy. Pure (no fs); the daemon (PR-1.1b) calls the
// cadence helper to decide when to snapshot. Operations layer, above the Freeze Surface.
//
// After PR-1.3-A, cold recovery is O(state + tail):
//
//   T_recovery  ≈  snapshot_load(state)  +  tail_ticks × per_tick_recovery(state)  +  margin
//
// So the SLA is a CADENCE choice, not a history limit: snapshot often enough that the worst-case tail
// (ticks since the last snapshot) replays within budget. per_tick / snapshot_load are machine- and
// state-dependent — measured by scripts/pr1-3-recovery-profile.mjs; the REFERENCE_* constants below are
// the values that derive the shipped cadence. The SLA guard test asserts the MODEL (tail ≤ cadence, and
// the budget arithmetic holds for the reference constants), NOT wall-clock time — so it is CI-stable.

/** The cold-recovery service-level objective. */
export const RECOVERY_SLA_MS = 60_000; // 60 s (pr1-charter.md)

/** Headroom reserved on top of the modelled cost (fs jitter, GC, cold caches). */
export const RECOVERY_MARGIN_MS = 5_000;

/** Operational cadence = N_max / SAFETY_FACTOR — never run at the SLA limit. */
export const SAFETY_FACTOR = 2;

// --- reference cost constants (measured 2026-06-07, single-agent state; see the profiler) ----------
// Used to derive the shipped cadence and to make the SLA budget arithmetic checkable in the guard test.
// per_tick is dominated by the tail REPLAY (full validate+reduce, with STATE_ROOT recomputed per event),
// not by parsing — measured ~11.6 ms/tick at tail 300 creeping to ~16 ms at tail 1200 (in-memory tail
// accumulation ⇒ GC pressure). 18 ms is a conservative round-up that covers the creep up to the cadence
// bound. It also GROWS with state size (STATE_ROOT is O(state)), so for a larger agent set the daemon
// should re-derive cadence (or stay conservative). snapshot_load is a few ms and ≈ flat vs history
// (f(state), not f(tail)) — measured ~1–5 ms; 10 ms conservative.
export const REFERENCE_PER_TICK_RECOVERY_MS = 18; // parse + full replay per tail tick (small state, conservative)
export const REFERENCE_SNAPSHOT_LOAD_MS = 10; // decode a small-state snapshot (≈ flat vs history)

/** Largest tail (ticks since the last snapshot) that still recovers within the SLA. */
export function maxTailForSla(slaMs: number, snapshotLoadMs: number, perTickMs: number, marginMs: number): number {
  return Math.max(0, Math.floor((slaMs - snapshotLoadMs - marginMs) / perTickMs));
}

/** The cadence to actually run: snapshot every N committed ticks, N = N_max / SAFETY_FACTOR. */
export function operationalCadence(slaMs: number, snapshotLoadMs: number, perTickMs: number, marginMs: number): number {
  return Math.max(1, Math.floor(maxTailForSla(slaMs, snapshotLoadMs, perTickMs, marginMs) / SAFETY_FACTOR));
}

/** Modelled worst-case recovery time at a given tail (the budget the guard checks against the SLA). */
export function predictedRecoveryMs(tailTicks: number, snapshotLoadMs: number, perTickMs: number, marginMs: number): number {
  return snapshotLoadMs + tailTicks * perTickMs + marginMs;
}

/**
 * The shipped operational cadence, derived from the reference constants. snapshot every this-many
 * committed ticks keeps the worst-case tail (= this value) recovering well within the SLA.
 */
export const OPERATIONAL_CADENCE_TICKS = operationalCadence(
  RECOVERY_SLA_MS,
  REFERENCE_SNAPSHOT_LOAD_MS,
  REFERENCE_PER_TICK_RECOVERY_MS,
  RECOVERY_MARGIN_MS,
);

/** True when a snapshot is due at `committedTicks` for cadence `everyNTicks` (the daemon's trigger). */
export function snapshotDue(committedTicks: number, everyNTicks: number = OPERATIONAL_CADENCE_TICKS): boolean {
  return committedTicks > 0 && committedTicks % everyNTicks === 0;
}
