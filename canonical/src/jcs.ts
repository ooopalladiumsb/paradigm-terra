/**
 * Restricted JCS profile per CE v1.3 §4.
 *
 * Based on RFC 8785 with the following domain restrictions:
 *   - Numbers: integers only (decimal, no leading zeros, no '+', no '-0', no exponent).
 *     Encoded internally as bigint to preserve precision beyond 2^53.
 *   - Object keys: no duplicates (semantic — checked after unescaping).
 *   - Strings: no lone UTF-16 surrogate sequences; no BOM at start.
 *   - Forbidden values: NaN, Infinity, fractional, exponential.
 *   - Output: keys sorted by UTF-8 byte order (lex), minimal whitespace.
 *
 * Two entry points:
 *   - canonicalizeString(json) — accepts a raw JSON string, parses with
 *     duplicate-key detection, returns canonical bytes.
 *   - canonicalizeValue(value) — accepts a JS value (using JcsValue type),
 *     returns canonical bytes. JS object literals cannot have duplicate keys,
 *     so this path skips dup-key detection.
 */

import { NoncanonicalEventError } from "./errors.js";
import { assertAssigned } from "./strings.js";

export type JcsValue =
  | null
  | boolean
  | bigint
  | string
  | readonly JcsValue[]
  | JcsObject;

export interface JcsObject {
  readonly [key: string]: JcsValue;
}

// ============================================================================
// Parser (string → JcsValue) with duplicate-key detection
// ============================================================================

class JcsParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): JcsValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos !== this.src.length) {
      throw err("JCS_TRAILING_INPUT", `unexpected character at position ${this.pos}`);
    }
    return value;
  }

  private parseValue(): JcsValue {
    this.skipWhitespace();
    if (this.pos >= this.src.length) {
      throw err("JCS_UNEXPECTED_EOF", "unexpected end of input");
    }
    const c = this.src.charCodeAt(this.pos);
    if (c === 0x7b) return this.parseObject(); // {
    if (c === 0x5b) return this.parseArray(); // [
    if (c === 0x22) return this.parseString(); // "
    if (c === 0x74 || c === 0x66) return this.parseBool(); // t, f
    if (c === 0x6e) return this.parseNull(); // n
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return this.parseNumber(); // - or 0-9
    throw err("JCS_UNEXPECTED_CHAR", `unexpected character at position ${this.pos}: ${this.src[this.pos]}`);
  }

  private parseObject(): JcsObject {
    this.expect(0x7b); // {
    const out: Record<string, JcsValue> = {};
    const seenKeys = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === 0x7d) {
      this.pos++;
      return out;
    }
    while (true) {
      this.skipWhitespace();
      if (this.peek() !== 0x22) {
        throw err("JCS_KEY_NOT_STRING", `expected string key at position ${this.pos}`);
      }
      const key = this.parseString();
      if (seenKeys.has(key)) {
        throw err("JCS_DUPLICATE_KEY", `duplicate key ${JSON.stringify(key)}`);
      }
      seenKeys.add(key);
      this.skipWhitespace();
      this.expect(0x3a); // :
      const value = this.parseValue();
      out[key] = value;
      this.skipWhitespace();
      const next = this.peek();
      if (next === 0x2c) {
        this.pos++;
        continue;
      }
      if (next === 0x7d) {
        this.pos++;
        return out;
      }
      throw err("JCS_EXPECTED_COMMA_OR_BRACE", `expected ',' or '}' at position ${this.pos}`);
    }
  }

  private parseArray(): JcsValue[] {
    this.expect(0x5b); // [
    const out: JcsValue[] = [];
    this.skipWhitespace();
    if (this.peek() === 0x5d) {
      this.pos++;
      return out;
    }
    while (true) {
      const value = this.parseValue();
      out.push(value);
      this.skipWhitespace();
      const next = this.peek();
      if (next === 0x2c) {
        this.pos++;
        continue;
      }
      if (next === 0x5d) {
        this.pos++;
        return out;
      }
      throw err("JCS_EXPECTED_COMMA_OR_BRACKET", `expected ',' or ']' at position ${this.pos}`);
    }
  }

  private parseString(): string {
    this.expect(0x22); // "
    let result = "";
    while (true) {
      if (this.pos >= this.src.length) {
        throw err("JCS_STRING_UNTERMINATED", "unterminated string");
      }
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x22) {
        // closing "
        this.pos++;
        return result;
      }
      if (c === 0x5c) {
        // backslash
        this.pos++;
        if (this.pos >= this.src.length) {
          throw err("JCS_BAD_ESCAPE", "trailing backslash in string");
        }
        const esc = this.src.charCodeAt(this.pos++);
        switch (esc) {
          case 0x22:
            result += '"';
            break;
          case 0x5c:
            result += "\\";
            break;
          case 0x2f:
            result += "/";
            break;
          case 0x62:
            result += "\b";
            break;
          case 0x66:
            result += "\f";
            break;
          case 0x6e:
            result += "\n";
            break;
          case 0x72:
            result += "\r";
            break;
          case 0x74:
            result += "\t";
            break;
          case 0x75: {
            if (this.pos + 4 > this.src.length) {
              throw err("JCS_BAD_UNICODE_ESCAPE", "truncated \\u escape");
            }
            const hex = this.src.slice(this.pos, this.pos + 4);
            this.pos += 4;
            const code = Number.parseInt(hex, 16);
            if (!Number.isInteger(code) || code < 0 || code > 0xffff || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw err("JCS_BAD_UNICODE_ESCAPE", `invalid \\u escape: \\u${hex}`);
            }
            if (code >= 0xd800 && code <= 0xdfff) {
              throw err(
                "JCS_SURROGATE_ESCAPE",
                `surrogate \\u escape forbidden in canonical JSON: \\u${hex}`,
              );
            }
            result += String.fromCharCode(code);
            break;
          }
          default:
            throw err("JCS_BAD_ESCAPE", `invalid escape \\${String.fromCharCode(esc)}`);
        }
        continue;
      }
      if (c < 0x20) {
        throw err("JCS_CONTROL_IN_STRING", `unescaped control character U+${c.toString(16).padStart(4, "0")}`);
      }
      // Detect lone surrogates in raw input (post-JSON unescaping happens separately).
      if (c >= 0xd800 && c <= 0xdfff) {
        if (c >= 0xd800 && c <= 0xdbff && this.pos + 1 < this.src.length) {
          const next = this.src.charCodeAt(this.pos + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            result += this.src[this.pos]! + this.src[this.pos + 1]!;
            this.pos += 2;
            continue;
          }
        }
        throw err("JCS_LONE_SURROGATE", `lone surrogate in string input`);
      }
      result += this.src[this.pos]!;
      this.pos++;
    }
  }

  private parseNumber(): bigint {
    const start = this.pos;
    if (this.peek() === 0x2d) this.pos++; // -
    const intStart = this.pos;
    if (this.peek() === 0x30) {
      this.pos++;
    } else if (this.peek() !== null && this.peek()! >= 0x31 && this.peek()! <= 0x39) {
      while (this.peek() !== null && this.peek()! >= 0x30 && this.peek()! <= 0x39) {
        this.pos++;
      }
    } else {
      throw err("JCS_BAD_NUMBER", `invalid number at position ${start}`);
    }
    // Check for forbidden fractional/exponential
    const tail = this.peek();
    if (tail === 0x2e) {
      throw err("JCS_FRACTIONAL_FORBIDDEN", `fractional numbers are forbidden`);
    }
    if (tail === 0x65 || tail === 0x45) {
      throw err("JCS_EXPONENT_FORBIDDEN", `exponential notation is forbidden`);
    }
    const text = this.src.slice(start, this.pos);
    // Reject "+" prefix (impossible per grammar above, but guard anyway).
    if (text.startsWith("+")) {
      throw err("JCS_BAD_NUMBER", `numbers must not start with '+'`);
    }
    // Reject leading zeros: "01", "-01" (but allow "0" and "-0" → -0 is also rejected below).
    const digitPart = this.src.slice(intStart, this.pos);
    if (digitPart.length > 1 && digitPart.startsWith("0")) {
      throw err("JCS_LEADING_ZERO", `numbers must not have leading zeros: ${text}`);
    }
    // Reject -0 explicitly.
    if (text === "-0") {
      throw err("JCS_NEGATIVE_ZERO", `'-0' is forbidden`);
    }
    return BigInt(text);
  }

  private parseBool(): boolean {
    if (this.src.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    throw err("JCS_BAD_LITERAL", `invalid literal at position ${this.pos}`);
  }

  private parseNull(): null {
    if (this.src.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    throw err("JCS_BAD_LITERAL", `invalid literal at position ${this.pos}`);
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private peek(): number | null {
    return this.pos < this.src.length ? this.src.charCodeAt(this.pos) : null;
  }

  private expect(charCode: number): void {
    if (this.peek() !== charCode) {
      throw err(
        "JCS_EXPECTED_CHAR",
        `expected '${String.fromCharCode(charCode)}' at position ${this.pos}, got '${this.src[this.pos] ?? "<EOF>"}'`,
      );
    }
    this.pos++;
  }
}

function err(code: string, msg: string): NoncanonicalEventError {
  return new NoncanonicalEventError(code, msg);
}

// ============================================================================
// Validator (any JS value → JcsValue)
// ============================================================================

const MAX_UINT256 = (1n << 256n) - 1n;
const MIN_INT256 = -(1n << 255n);

function coerceToJcsValue(value: unknown, path: string): JcsValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") {
    if (value > MAX_UINT256 || value < MIN_INT256) {
      // We don't have a fixed numeric range across JCS, but flag obviously out-of-range.
      // (Schema-specific range checks live in integers.ts.)
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw err("JCS_NON_FINITE_NUMBER", `non-finite number at ${path}: ${value}`);
    }
    if (!Number.isInteger(value)) {
      throw err("JCS_FRACTIONAL_FORBIDDEN", `fractional numbers are forbidden at ${path}: ${value}`);
    }
    if (Object.is(value, -0)) {
      throw err("JCS_NEGATIVE_ZERO", `'-0' is forbidden at ${path}`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    // Validate UTF-16 surrogate well-formedness (NFC normalization happens at serialize).
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        if (i + 1 < value.length) {
          const next = value.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            i++;
            continue;
          }
        }
        throw err("JCS_LONE_SURROGATE", `lone surrogate in string at ${path}`);
      }
      if (c >= 0xdc00 && c <= 0xdfff) {
        throw err("JCS_LONE_SURROGATE", `lone low surrogate in string at ${path}`);
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => coerceToJcsValue(v, `${path}[${i}]`));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, JcsValue> = {};
    for (const k of Object.keys(obj)) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        // We assume JS objects cannot have duplicate own keys (true at runtime).
        out[k] = coerceToJcsValue(obj[k], `${path}.${k}`);
      }
    }
    return out;
  }
  throw err("JCS_UNSUPPORTED_TYPE", `unsupported type at ${path}: ${typeof value}`);
}

// ============================================================================
// Serializer (JcsValue → canonical bytes)
// ============================================================================

/**
 * Compare two strings by NFC UTF-8 byte order, for canonical key sort.
 * Pure ordering — no validation here. A leading-BOM string is rejected by
 * escapeString (which every key and value passes through), so rejection no
 * longer depends on key count or sort order.
 */
function compareUtf8Bytes(a: string, b: string): number {
  const ab = TEXT_ENCODER.encode(a.normalize("NFC"));
  const bb = TEXT_ENCODER.encode(b.normalize("NFC"));
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = ab[i]!;
    const bv = bb[i]!;
    if (av !== bv) return av - bv;
  }
  return ab.length - bb.length;
}

/**
 * RFC 8785 §3.2.2.2 string escaping (the "minimal" form).
 * Characters U+0000..U+001F must be escaped; " and \ must be escaped;
 * everything else is emitted as raw UTF-8.
 */
function escapeString(s: string): string {
  // CE §3.2: a canonical string MUST NOT begin with U+FEFF (BOM). This applies
  // to every JSON string token — keys and values alike — independent of object
  // key count. Mid-string U+FEFF (ZWNBSP) is permitted.
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) {
    throw err("UTF8_BOM_FORBIDDEN", "BOM at start of JSON string is forbidden");
  }
  assertAssigned(s);
  let out = '"';
  const normalized = s.normalize("NFC");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    if (c === 0x22) {
      out += '\\"';
    } else if (c === 0x5c) {
      out += "\\\\";
    } else if (c === 0x08) {
      out += "\\b";
    } else if (c === 0x09) {
      out += "\\t";
    } else if (c === 0x0a) {
      out += "\\n";
    } else if (c === 0x0c) {
      out += "\\f";
    } else if (c === 0x0d) {
      out += "\\r";
    } else if (c < 0x20) {
      out += `\\u${c.toString(16).padStart(4, "0")}`;
    } else {
      out += normalized[i];
    }
  }
  out += '"';
  return out;
}

function serialize(value: JcsValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string") return escapeString(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as JcsObject;
    const keys = Object.keys(obj).slice().sort(compareUtf8Bytes);
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k]!;
      // escapeString validates the key (NFC, no leading BOM) and emits it.
      parts.push(`${escapeString(k)}:${serialize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw err("JCS_UNSUPPORTED_TYPE", `unsupported value in serialize`);
}

// ============================================================================
// Public API
// ============================================================================

const TEXT_ENCODER = new TextEncoder();

/** Parse a JSON string with restricted-JCS validation and return canonical bytes. */
export function canonicalizeString(json: string): Uint8Array {
  const parsed = new JcsParser(json).parse();
  return TEXT_ENCODER.encode(serialize(parsed));
}

/** Serialize a JS value canonically. Numbers MUST be bigint or integer Number. */
export function canonicalizeValue(value: unknown): Uint8Array {
  const coerced = coerceToJcsValue(value, "$");
  return TEXT_ENCODER.encode(serialize(coerced));
}

/** Parse and return the typed JcsValue (useful for inspection / round-trip tests). */
export function parseCanonical(json: string): JcsValue {
  return new JcsParser(json).parse();
}

/** Serialize a JcsValue to canonical string form (UTF-8 string, no NFC issues). */
export function serializeCanonical(value: JcsValue): string {
  return serialize(value);
}
