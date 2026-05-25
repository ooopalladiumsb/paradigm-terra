// Differential-fuzz harness for the TypeScript reference (@paradigm-terra/cal-reducer).
//
// Protocol (shared by all three language harnesses):
//   stdin  : one case per line; each line is the hex of the canonical-JSON
//            document  { "start": <state>, "events": [<event>, ...] }.
//   stdout : one result line per input line, in order:
//              "OK <lowercase-hex-state-root>"   after folding the whole sequence
//              "ERR <CODE>@<index>"              first ApplyError, with its index
//              "ERR BADCASE"                     unparseable case (should never differ)
//
// Only accept/reject, the resulting STATE_ROOT, and the (code, index) of a fault
// are compared — and all three are required to agree (the reducer is a total,
// deterministic Tier-3 function, §7.2).

import { readFileSync } from "node:fs";
import { parseCanonical, toHex } from "@paradigm-terra/canonical";
import { materialize, stateRootOf } from "../dist/index.js";

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.substr(2 * i, 2), 16);
  return out;
}
const dec = new TextDecoder("utf-8", { fatal: true });

function handle(line) {
  let doc;
  try {
    doc = parseCanonical(dec.decode(hexToBytes(line)));
  } catch {
    return "ERR BADCASE";
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc) || !Array.isArray(doc.events)) {
    return "ERR BADCASE";
  }
  const r = materialize(doc.events, doc.start);
  if (r.ok) return "OK " + toHex(stateRootOf(r.state));
  return `ERR ${r.code}@${r.index}`;
}

const lines = readFileSync(0, "utf-8").split("\n");
const out = [];
for (const line of lines) {
  if (line.length === 0) continue;
  out.push(handle(line));
}
process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
