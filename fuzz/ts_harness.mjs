// Differential-fuzz harness for the TypeScript reference (@paradigm-terra/canonical).
//
// Protocol (shared by all three language harnesses):
//   stdin  : one test case per line, tab-separated fields, all payloads hex.
//   stdout : one result line per input line, in order:
//              "OK <lowercase-hex>"  on success
//              "ERR"                 on any rejection (error codes are NOT compared;
//                                     only accept/reject + output bytes are)
//
// Case formats (field 0 is the op):
//   int256\t<decimal-utf8-hex>
//   uint256\t<decimal-utf8-hex>
//   uint64\t<decimal-utf8-hex>
//   nfc\t<string-utf8-hex>
//   jcs\t<json-doc-utf8-hex>
//   address\t<string-utf8-hex>
//   frame\t<typeTag-dec>\t<version-dec>\t<payload-hex>
//   merkle\t<nodeTag-utf8-hex>\t<leafHex,leafHex,...>
//   domain_hash\t<tag-utf8-hex>\t<payload-hex>

import { readFileSync } from "node:fs";
import {
  encodeInt256,
  encodeUint256,
  encodeUint64,
  utf8NfcBytes,
  canonicalizeString,
  addressToBytes,
  encodeFrame,
  binaryMerkle,
  domainHash,
  toHex,
} from "../canonical/dist/index.js";

function hexToBytes(h) {
  if (h.length === 0) return new Uint8Array(0);
  if (h.length % 2 !== 0) throw new Error("odd hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = Number.parseInt(h.substr(2 * i, 2), 16);
    if (Number.isNaN(v)) throw new Error("bad hex");
    out[i] = v;
  }
  return out;
}

// ignoreBOM:true keeps a leading U+FEFF as a real character — matching Go's
// `string(bytes)` and Rust's `String::from_utf8`, which never strip a BOM.
// (Without this, JS TextDecoder silently drops a leading BOM and the harness
// would feed a different string than the other two.)
const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function bytesToStr(b) {
  return dec.decode(b);
}

function handle(line) {
  const f = line.split("\t");
  const op = f[0];
  switch (op) {
    case "int256":
      return encodeInt256(BigInt(bytesToStr(hexToBytes(f[1]))));
    case "uint256":
      return encodeUint256(BigInt(bytesToStr(hexToBytes(f[1]))));
    case "uint64":
      return encodeUint64(BigInt(bytesToStr(hexToBytes(f[1]))));
    case "nfc":
      return utf8NfcBytes(bytesToStr(hexToBytes(f[1])));
    case "jcs":
      return canonicalizeString(bytesToStr(hexToBytes(f[1])));
    case "address":
      return addressToBytes(bytesToStr(hexToBytes(f[1])));
    case "frame": {
      const typeTag = Number.parseInt(f[1], 10);
      const version = Number.parseInt(f[2], 10);
      const payload = hexToBytes(f[3] ?? "");
      return encodeFrame({ typeTag, version, payload });
    }
    case "merkle": {
      const tag = bytesToStr(hexToBytes(f[1]));
      const leavesField = f[2] ?? "";
      const leaves =
        leavesField.length === 0 ? [] : leavesField.split(",").map((h) => hexToBytes(h));
      return binaryMerkle(leaves, tag);
    }
    case "domain_hash": {
      const tag = bytesToStr(hexToBytes(f[1]));
      const payload = hexToBytes(f[2] ?? "");
      return domainHash(tag, payload);
    }
    default:
      throw new Error("unknown op: " + op);
  }
}

const input = readFileSync(0, "utf-8");
const lines = input.split("\n");
const out = [];
for (const line of lines) {
  if (line.length === 0) continue;
  try {
    out.push("OK " + toHex(handle(line)));
  } catch {
    out.push("ERR");
  }
}
process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
