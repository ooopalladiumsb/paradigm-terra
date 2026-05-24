/**
 * Binary framing per CE v1.3 §8.1.
 *
 *   [type_tag: uint16 BE][version: uint16 BE][length: uint32 BE][payload bytes]
 *
 * `length` MUST equal `payload.length` and MUST NOT exceed 2^32 - 1.
 * Reserved type tags: 0x0000–0x00FF (system).
 */

import { CanonicalEncodingError } from "./errors.js";
import { encodeUint16 } from "./integers.js";

const MAX_LENGTH = 0xffffffff;

export interface Frame {
  readonly typeTag: number; // uint16
  readonly version: number; // uint16
  readonly payload: Uint8Array;
}

export function encodeFrame(frame: Frame): Uint8Array {
  if (!Number.isInteger(frame.typeTag) || frame.typeTag < 0 || frame.typeTag > 0xffff) {
    throw new CanonicalEncodingError("FRAME_BAD_TYPE_TAG", `type_tag out of range: ${frame.typeTag}`);
  }
  if (!Number.isInteger(frame.version) || frame.version < 0 || frame.version > 0xffff) {
    throw new CanonicalEncodingError("FRAME_BAD_VERSION", `version out of range: ${frame.version}`);
  }
  const len = frame.payload.length;
  if (len > MAX_LENGTH) {
    throw new CanonicalEncodingError("FRAME_PAYLOAD_TOO_LARGE", `payload length ${len} exceeds 2^32-1`);
  }
  const out = new Uint8Array(8 + len);
  out.set(encodeUint16(frame.typeTag), 0);
  out.set(encodeUint16(frame.version), 2);
  // length: uint32 BE
  out[4] = (len >>> 24) & 0xff;
  out[5] = (len >>> 16) & 0xff;
  out[6] = (len >>> 8) & 0xff;
  out[7] = len & 0xff;
  out.set(frame.payload, 8);
  return out;
}

export function decodeFrame(bytes: Uint8Array): Frame {
  if (bytes.length < 8) {
    throw new CanonicalEncodingError("FRAME_TOO_SHORT", `frame must be at least 8 bytes, got ${bytes.length}`);
  }
  const typeTag = (bytes[0]! << 8) | bytes[1]!;
  const version = (bytes[2]! << 8) | bytes[3]!;
  const len =
    (bytes[4]! * 0x1000000) + ((bytes[5]! << 16) | (bytes[6]! << 8) | bytes[7]!);
  if (bytes.length !== 8 + len) {
    throw new CanonicalEncodingError(
      "FRAME_LENGTH_MISMATCH",
      `declared length ${len} does not match actual payload length ${bytes.length - 8}`,
    );
  }
  return { typeTag, version, payload: bytes.slice(8) };
}
