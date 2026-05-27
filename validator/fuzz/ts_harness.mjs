// Differential-fuzz harness for the TypeScript reference (@paradigm-terra/cal-validator).
//
// Protocol (shared by all three language harnesses):
//   stdin  : one case per line — hex of canonical-JSON { cal, cal_hash, snapshot, trace }
//            where `trace` is the JCS form { current_tick, owner_sig_present,
//            state_before, state_after, steps:[{ok, effects, error_detail?}] }.
//   stdout : "OK <types>|<stage>|<reason>|<escrow>|<tfee>|<gc>|<gr>|<fr,dg,gr,tac>"
//            / "ERR BADCASE" / "ERR COMPUTE", in order. `<types>` is the emitted
//            event_type sequence (comma-joined); `<escrow>` is cal.validated's
//            escrow_ptra (§9.3 = fee + Max_Expected_Dynamic_Gas); `<gr>` is the
//            terminal event's gas_refunded_ptra; "-" marks an absent field; all
//            amounts are decimal uint256, so the three impls must agree byte-for-byte.

import { readFileSync } from "node:fs";
import { parseCanonical } from "@paradigm-terra/canonical";
import { validate } from "../dist/index.js";

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.substr(2 * i, 2), 16);
  return out;
}
const dec = new TextDecoder("utf-8", { fatal: true });

function buildTrace(j) {
  const steps = Array.isArray(j?.steps)
    ? j.steps.map((s) => {
        const st = { ok: s?.ok === true, effects: Array.isArray(s?.effects) ? s.effects : [] };
        if (typeof s?.error_detail === "string") st.errorDetail = s.error_detail;
        return st;
      })
    : [];
  return {
    currentTick: typeof j?.current_tick === "bigint" ? j.current_tick : 0n,
    steps,
    stateBefore: j?.state_before ?? null,
    stateAfter: j?.state_after ?? null,
    ownerSigPresent: j?.owner_sig_present === true,
  };
}

function ev(events, type, key) {
  const e = events.find((x) => x["event_type"] === type);
  const v = e?.[key];
  return typeof v === "bigint" ? v.toString() : "-";
}

function handle(line) {
  let doc;
  try {
    doc = parseCanonical(dec.decode(hexToBytes(line)));
  } catch {
    return "ERR BADCASE";
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return "ERR BADCASE";
  const { cal, cal_hash: calHash, snapshot, trace } = doc;
  if (typeof calHash !== "string") return "ERR BADCASE";
  try {
    const res = validate(cal, calHash, snapshot, buildTrace(trace));
    const types = res.events.map((e) => e["event_type"]).join(",");
    const term = res.events[res.events.length - 1] ?? {};
    const tfee = typeof term["fee_debited_ptra"] === "bigint" ? term["fee_debited_ptra"].toString() : "-";
    const gc = typeof term["gas_consumed_ptra"] === "bigint" ? term["gas_consumed_ptra"].toString() : "-";
    const gr = typeof term["gas_refunded_ptra"] === "bigint" ? term["gas_refunded_ptra"].toString() : "-";
    const b = res.bill;
    return `OK ${types}|${res.terminalStage}|${res.reasonCode ?? "-"}|${ev(res.events, "cal.validated", "escrow_ptra")}|${tfee}|${gc}|${gr}|${b.feeRetained},${b.dynamicGasConsumed},${b.gasRefunded},${b.totalAgentCharge}`;
  } catch {
    return "ERR COMPUTE";
  }
}

const out = [];
for (const line of readFileSync(0, "utf-8").split("\n")) {
  if (line.length === 0) continue;
  out.push(handle(line));
}
process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
