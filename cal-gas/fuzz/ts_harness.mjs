// Differential-fuzz harness for the TypeScript reference (@paradigm-terra/cal-gas).
//
// Protocol (shared by all three language harnesses):
//   stdin  : one case per line — hex of canonical-JSON { cal, state, bytes_written }.
//   stdout : one result line per input line, in order:
//              "OK <su> <gu> <esc> <cv> <FIN> <FP> <FNC> <FE> <EPRE> <EPOST>"
//                where <cv> is 1/0 and each outcome is `feeRet,gasCons,gasRef,total`
//              "ERR BADCASE"   unparseable case
//              "ERR COMPUTE"   a pricing/settle computation raised (e.g. bad DSL)
//
// All values are decimal uint256 strings, so the three implementations must emit
// byte-identical lines (the gas layer is pure and deterministic, §9.2–§9.4).

import { readFileSync } from "node:fs";
import { parseCanonical } from "@paradigm-terra/canonical";
import { canValidate, escrowRequirement, gasUnits, settle, staticGasUnits } from "../dist/index.js";

const OUTCOMES = ["FINALIZED", "FAILED_PRECOND", "FAILED_NO_CHARGE", "FAILED_EXEC", "EXPIRED_PRE", "EXPIRED_POST"];

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.substr(2 * i, 2), 16);
  return out;
}
const dec = new TextDecoder("utf-8", { fatal: true });

function quad(b) {
  return `${b.feeRetained},${b.dynamicGasConsumed},${b.gasRefunded},${b.totalAgentCharge}`;
}

function handle(line) {
  let doc;
  try {
    doc = parseCanonical(dec.decode(hexToBytes(line)));
  } catch {
    return "ERR BADCASE";
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return "ERR BADCASE";
  const { cal, state, bytes_written: bytes } = doc;
  if (typeof bytes !== "bigint") return "ERR BADCASE";
  try {
    const su = staticGasUnits(cal);
    const gu = gasUnits(cal, bytes);
    const esc = escrowRequirement(cal, state);
    const cv = canValidate(cal, state) ? "1" : "0";
    const bills = OUTCOMES.map((o) => quad(settle(o, cal, state, bytes)));
    return `OK ${su} ${gu} ${esc} ${cv} ${bills.join(" ")}`;
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
