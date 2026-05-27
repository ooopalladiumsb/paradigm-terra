/**
 * The reducer: `apply(State, Event) -> State` (CAL Spec §7.1, reducer design §5).
 *
 * Pure and total — illegal events return a typed ApplyError in the result, never
 * throw at the boundary. Events are self-describing: economic values and step
 * effects (Deltas) are carried in the event; the reducer moves/replays them. It
 * does not evaluate DSL, price gas, or touch any external. All-or-nothing is
 * realized by per-CAL staging: step effects accrue in `in_flight[cal_hash].staged`
 * and commit only at `cal.finalized` (dropped on `cal.failed`/`cal.expired`).
 */

import { applyDeltaJson, UINT256_MAX } from "./delta.js";
import { ApplyError } from "./errors.js";
import { deleteIn, getIn, setIn, type Json, type State } from "./state.js";

export type ApplyResult = { ok: true; state: State } | { ok: false; code: string };

type Event = { [k: string]: Json };

function reqStr(ev: Event, k: string): string {
  const v = ev[k];
  if (typeof v !== "string") throw new ApplyError("BAD_DELTA", `event.${k} must be a string`);
  return v;
}
function reqUint(ev: Event, k: string): bigint {
  const v = ev[k];
  if (typeof v !== "bigint" || v < 0n || v > UINT256_MAX) throw new ApplyError("BAD_DELTA", `event.${k} must be a uint256`);
  return v;
}
function optUint(ev: Event, k: string): bigint {
  return k in ev ? reqUint(ev, k) : 0n;
}

function inFlight(state: State, ch: string): { [k: string]: Json } | undefined {
  const v = getIn(state, ["cal", "in_flight", ch]);
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as { [k: string]: Json }) : undefined;
}
function requireFlight(state: State, ch: string): { [k: string]: Json } {
  const h = inFlight(state, ch);
  if (!h) throw new ApplyError("UNKNOWN_CAL", ch);
  return h;
}
function bal(state: State, addr: string): bigint {
  const v = getIn(state, ["ptra", "balances", addr]);
  return typeof v === "bigint" ? v : 0n;
}
function bumpNonce(state: State, agent: string): State {
  const cur = getIn(state, ["cal", "nonces", agent]);
  return setIn(state, ["cal", "nonces", agent], (typeof cur === "bigint" ? cur : 0n) + 1n) as State;
}
function addFees(state: State, amount: bigint): State {
  const cur = getIn(state, ["treasury", "collected_fees_window"]);
  return setIn(state, ["treasury", "collected_fees_window"], (typeof cur === "bigint" ? cur : 0n) + amount) as State;
}

/** Deterministic Bounded-Mode recompute (subset of §10.1: the counter trigger). */
function recomputeBounded(state: State): State {
  const threshold = getIn(state, ["governance", "params", "capture_guard_threshold"]);
  let bounded = false;
  if (typeof threshold === "bigint") {
    const counters = getIn(state, ["failure_mode", "capture_guard_counters"]);
    if (typeof counters === "object" && counters !== null && !Array.isArray(counters)) {
      for (const v of Object.values(counters)) {
        if (typeof v === "bigint" && v >= threshold) bounded = true;
      }
    }
  }
  return setIn(state, ["failure_mode", "is_bounded_mode"], bounded) as State;
}

function applyEvent(state: State, ev: Event): State {
  const type = ev["event_type"];
  if (typeof type !== "string") throw new ApplyError("UNKNOWN_EVENT", "missing event_type");

  switch (type) {
    case "cal.created": {
      const ch = reqStr(ev, "cal_hash");
      const agent = reqStr(ev, "agent_id");
      if (inFlight(state, ch)) throw new ApplyError("DUPLICATE_CAL", ch);
      const all = getIn(state, ["cal", "in_flight"]);
      if (typeof all === "object" && all !== null && !Array.isArray(all)) {
        for (const h of Object.values(all)) {
          if (typeof h === "object" && h !== null && !Array.isArray(h) && (h as Event)["agent_id"] === agent) {
            throw new ApplyError("AGENT_BUSY", agent);
          }
        }
      }
      return setIn(state, ["cal", "in_flight", ch], {
        agent_id: agent,
        stage: "CREATED",
        escrowed_ptra: 0n,
        gas_consumed_ptra: 0n,
        staged: [],
      }) as State;
    }
    case "cal.signed": {
      const ch = reqStr(ev, "cal_hash");
      const h = requireFlight(state, ch);
      if (h["stage"] !== "CREATED") throw new ApplyError("BAD_STAGE", `${ch}:${String(h["stage"])}`);
      return setIn(state, ["cal", "in_flight", ch, "stage"], "SIGNED") as State;
    }
    case "cal.validated": {
      const ch = reqStr(ev, "cal_hash");
      const h = requireFlight(state, ch);
      if (h["stage"] !== "SIGNED") throw new ApplyError("BAD_STAGE", `${ch}:${String(h["stage"])}`);
      const agent = h["agent_id"] as string;
      // §9.3 upfront deposit: the agent escrows the full Flat_Validation_Fee +
      // Max_Expected_Dynamic_Gas at VALIDATED; the unused gas is refunded at the
      // terminal event and the treasury keeps escrow − refund (= fee + consumed).
      const escrow = reqUint(ev, "escrow_ptra");
      if (bal(state, agent) < escrow) throw new ApplyError("INSUFFICIENT_BALANCE", agent);
      let s = setIn(state, ["ptra", "balances", agent], bal(state, agent) - escrow) as State;
      s = setIn(s, ["cal", "in_flight", ch, "escrowed_ptra"], escrow) as State;
      return setIn(s, ["cal", "in_flight", ch, "stage"], "VALIDATED") as State;
    }
    case "cal.executed": {
      const ch = reqStr(ev, "cal_hash");
      const h = requireFlight(state, ch);
      if (h["stage"] !== "VALIDATED") throw new ApplyError("BAD_STAGE", `${ch}:${String(h["stage"])}`);
      const effects = ev["effects"];
      if (!Array.isArray(effects)) throw new ApplyError("BAD_DELTA", "executed.effects must be a list");
      let s = setIn(state, ["cal", "in_flight", ch, "staged"], effects) as State;
      s = setIn(s, ["cal", "in_flight", ch, "gas_consumed_ptra"], reqUint(ev, "gas_consumed_ptra")) as State;
      return setIn(s, ["cal", "in_flight", ch, "stage"], "EXECUTED") as State;
    }
    case "cal.settled": {
      const ch = reqStr(ev, "cal_hash");
      const h = requireFlight(state, ch);
      if (h["stage"] !== "EXECUTED") throw new ApplyError("BAD_STAGE", `${ch}:${String(h["stage"])}`);
      return setIn(state, ["cal", "in_flight", ch, "stage"], "SETTLED") as State;
    }
    case "cal.finalized": {
      const ch = reqStr(ev, "cal_hash");
      const h = requireFlight(state, ch);
      if (h["stage"] !== "SETTLED") throw new ApplyError("BAD_STAGE", `${ch}:${String(h["stage"])}`);
      const agent = h["agent_id"] as string;
      // Refund the unused gas from the escrow; the treasury keeps escrow − refund
      // (= Flat_Validation_Fee + consumed gas). Conserves: the agent's net debit
      // (escrow − refund) equals the treasury's gain.
      const escrowed = h["escrowed_ptra"] as bigint;
      const refund = optUint(ev, "gas_refunded_ptra");
      let s: State = state;
      for (const d of h["staged"] as Json[]) s = applyDeltaJson(s, d); // commit
      if (refund > 0n) s = setIn(s, ["ptra", "balances", agent], bal(s, agent) + refund) as State;
      if (refund > escrowed) throw new ApplyError("UNDERFLOW", ch); // refund can't exceed the escrow
      s = addFees(s, escrowed - refund);
      s = bumpNonce(s, agent);
      return deleteIn(s, ["cal", "in_flight", ch]) as State;
    }
    case "cal.failed":
    case "cal.expired": {
      const ch = reqStr(ev, "cal_hash");
      const h = requireFlight(state, ch);
      const agent = h["agent_id"] as string;
      const stage = h["stage"];
      // Staged effects are discarded (all-or-nothing, §3.5). The fee/gas settlement
      // splits by whether the CAL escrowed:
      let s: State = state;
      if (stage === "CREATED" || stage === "SIGNED") {
        // Pre-VALIDATED: no escrow was ever taken (no cal.validated). §9.4 charges a
        // spam fee on PRECOND_FALSE/CAPABILITY_DENIED — the event carries it
        // (min(fee, balance), baked by the validator); debit it and retain it.
        // No-charge / ingress-class failures carry 0.
        const chargeNow = optUint(ev, "fee_debited_ptra");
        if (bal(s, agent) < chargeNow) throw new ApplyError("INSUFFICIENT_BALANCE", agent);
        if (chargeNow > 0n) s = setIn(s, ["ptra", "balances", agent], bal(s, agent) - chargeNow) as State;
        s = addFees(s, chargeNow);
      } else {
        // Post-VALIDATED: the escrow (fee + maxGas) was debited at cal.validated.
        // Refund the unused gas; the treasury keeps escrow − refund (= fee +
        // consumed). Same arithmetic as cal.finalized, but staged effects are
        // dropped instead of committed.
        const escrowed = h["escrowed_ptra"] as bigint;
        const refund = optUint(ev, "gas_refunded_ptra");
        if (refund > 0n) s = setIn(s, ["ptra", "balances", agent], bal(s, agent) + refund) as State;
        if (refund > escrowed) throw new ApplyError("UNDERFLOW", ch); // refund can't exceed the escrow
        s = addFees(s, escrowed - refund);
      }
      s = bumpNonce(s, agent);
      return deleteIn(s, ["cal", "in_flight", ch]) as State;
    }
    case "ptra.transferred": {
      const from = reqStr(ev, "from");
      const to = reqStr(ev, "to");
      const amount = reqUint(ev, "amount_nano_ptra");
      if (bal(state, from) < amount) throw new ApplyError("INSUFFICIENT_BALANCE", from);
      let s = setIn(state, ["ptra", "balances", from], bal(state, from) - amount) as State;
      return setIn(s, ["ptra", "balances", to], bal(s, to) + amount) as State;
    }
    case "ptra.shadow_init": {
      const addr = reqStr(ev, "addr");
      if (getIn(state, ["ptra", "balances", addr]) !== undefined) return state; // idempotent
      return setIn(state, ["ptra", "balances", addr], 0n) as State;
    }
    case "oracle.feed_submitted": {
      const symbol = reqStr(ev, "symbol");
      return setIn(state, ["oracles", "feeds", symbol], ev["value"] ?? null) as State;
    }
    case "tick.advanced": {
      const next = reqUint(ev, "new_tick");
      const cur = getIn(state, ["tick", "current"]);
      if (!(typeof cur === "bigint") || next <= cur) throw new ApplyError("BAD_TICK", `${String(cur)} -> ${next}`);
      const s = setIn(state, ["tick", "current"], next) as State;
      return recomputeBounded(s);
    }
    default:
      throw new ApplyError("UNKNOWN_EVENT", type);
  }
}

/** Apply one event. Total: returns `{ok:false, code}` instead of throwing. */
export function apply(state: State, event: Event): ApplyResult {
  try {
    return { ok: true, state: applyEvent(state, event) };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, code: e.code };
    throw e;
  }
}
