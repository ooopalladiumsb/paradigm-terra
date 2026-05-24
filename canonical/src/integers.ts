/**
 * Integer encoding per CE v1.3 §3.1.
 *
 * - int256 / uint256 → 32 bytes big-endian
 * - uint64 → 8 bytes big-endian
 * - uint16 → 2 bytes big-endian
 * - uint8 → 1 byte
 *
 * int256 uses two's complement; negative values fill the high bytes with 0xff.
 * Hex representation: lowercase, fixed width, no '0x' prefix in raw bytes
 * (the '0x' prefix only appears in textual wrappers per §3.1).
 */

import { CanonicalEncodingError } from "./errors.js";

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_INT256 = (1n << 255n) - 1n;
const MIN_INT256 = -(1n << 255n);
const TWO_256 = 1n << 256n;

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT16 = (1 << 16) - 1;
const MAX_UINT8 = (1 << 8) - 1;

/** Encode an unsigned bigint as `byteLen` big-endian bytes. */
function encodeUnsignedBe(value: bigint, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  let v = value;
  for (let i = byteLen - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Decode a big-endian byte sequence as an unsigned bigint. */
function decodeUnsignedBe(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) {
    v = (v << 8n) | BigInt(b);
  }
  return v;
}

// ----- uint8 -----

export function encodeUint8(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isInteger(v) || v < 0 || v > MAX_UINT8) {
    throw new CanonicalEncodingError("UINT8_OUT_OF_RANGE", `uint8 must be 0..255, got ${value}`);
  }
  return new Uint8Array([v]);
}

// ----- uint16 -----

export function encodeUint16(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isInteger(v) || v < 0 || v > MAX_UINT16) {
    throw new CanonicalEncodingError("UINT16_OUT_OF_RANGE", `uint16 must be 0..65535, got ${value}`);
  }
  const out = new Uint8Array(2);
  out[0] = (v >>> 8) & 0xff;
  out[1] = v & 0xff;
  return out;
}

// ----- uint64 -----

export function encodeUint64(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n || v > MAX_UINT64) {
    throw new CanonicalEncodingError("UINT64_OUT_OF_RANGE", `uint64 must be 0..2^64-1, got ${value}`);
  }
  return encodeUnsignedBe(v, 8);
}

// ----- uint256 -----

export function encodeUint256(value: bigint | number): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n || v > MAX_UINT256) {
    throw new CanonicalEncodingError("UINT256_OUT_OF_RANGE", `uint256 must be 0..2^256-1, got ${value}`);
  }
  return encodeUnsignedBe(v, 32);
}

export function decodeUint256(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) {
    throw new CanonicalEncodingError("UINT256_BAD_LENGTH", `uint256 must be 32 bytes, got ${bytes.length}`);
  }
  return decodeUnsignedBe(bytes);
}

// ----- int256 (two's complement) -----

export function encodeInt256(value: bigint | number): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < MIN_INT256 || v > MAX_INT256) {
    throw new CanonicalEncodingError("INT256_OUT_OF_RANGE", `int256 out of range, got ${value}`);
  }
  const unsigned = v >= 0n ? v : v + TWO_256;
  return encodeUnsignedBe(unsigned, 32);
}

export function decodeInt256(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) {
    throw new CanonicalEncodingError("INT256_BAD_LENGTH", `int256 must be 32 bytes, got ${bytes.length}`);
  }
  const u = decodeUnsignedBe(bytes);
  return u >= 1n << 255n ? u - TWO_256 : u;
}

// ----- hex helpers (lowercase, fixed-width, optional 0x prefix) -----

export function toHex(bytes: Uint8Array, prefix: boolean = false): string {
  let s = "";
  for (const b of bytes) {
    s += b.toString(16).padStart(2, "0");
  }
  return prefix ? `0x${s}` : s;
}

export function fromHex(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) {
    throw new CanonicalEncodingError("HEX_ODD_LENGTH", `hex string must have even length, got ${stripped.length}`);
  }
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = parseHexDigit(stripped.charCodeAt(2 * i));
    const lo = parseHexDigit(stripped.charCodeAt(2 * i + 1));
    if (hi < 0 || lo < 0) {
      throw new CanonicalEncodingError("HEX_INVALID_CHAR", `invalid hex character at position ${2 * i}`);
    }
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function parseHexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F (accepted on input)
  return -1;
}

// ----- text-format hex per CE §3.1 (lowercase, fixed width, with 0x prefix) -----

export function int256ToHexText(value: bigint | number): string {
  return toHex(encodeInt256(value), true);
}

export function uint256ToHexText(value: bigint | number): string {
  return toHex(encodeUint256(value), true);
}

export function uint64ToHexText(value: bigint | number): string {
  return toHex(encodeUint64(value), true);
}

export function uint16ToHexText(value: number | bigint): string {
  return toHex(encodeUint16(value), true);
}
