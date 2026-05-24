import { test } from "node:test";
import assert from "node:assert/strict";
import { compareNfc, utf8NfcBytes } from "../src/strings.js";
import { NoncanonicalEventError } from "../src/errors.js";

test("NFC: composes 'e\\u0301' → 'é'", () => {
  const decomposed = "é"; // 2 code points
  const composed = "é"; // 1 code point
  assert.deepEqual(utf8NfcBytes(decomposed), utf8NfcBytes(composed));
});

test("NFC bytes for 'hello' are ASCII", () => {
  assert.deepEqual(utf8NfcBytes("hello"), new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
});

test("NFC handles multilingual: cyrillic, CJK, arabic", () => {
  const ru = utf8NfcBytes("привет");
  const zh = utf8NfcBytes("你好");
  const ar = utf8NfcBytes("سلام");
  assert.ok(ru.length > 0);
  assert.ok(zh.length > 0);
  assert.ok(ar.length > 0);
});

test("BOM at start of string is forbidden", () => {
  assert.throws(() => utf8NfcBytes("﻿hello"), NoncanonicalEventError);
});

test("lone high surrogate is forbidden", () => {
  // Construct a string with a lone high surrogate via fromCharCode.
  const loneHigh = String.fromCharCode(0xd83d) + "x";
  assert.throws(() => utf8NfcBytes(loneHigh), NoncanonicalEventError);
});

test("valid surrogate pair (emoji) survives NFC", () => {
  // U+1F600 GRINNING FACE = D83D DE00
  const emoji = "😀";
  const bytes = utf8NfcBytes(emoji);
  assert.deepEqual(bytes, new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
});

test("compareNfc: byte-wise after normalization", () => {
  assert.equal(compareNfc("a", "b") < 0, true);
  assert.equal(compareNfc("aa", "ab") < 0, true);
  assert.equal(compareNfc("a", "a") === 0, true);
  assert.equal(compareNfc("é", "é") === 0, true);
});
