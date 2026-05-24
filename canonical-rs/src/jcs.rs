//! Restricted JCS profile per CE v1.3 §4 — parity with `jcs.ts`.
//!
//! Based on RFC 8785 with these domain restrictions:
//!   - Numbers: integers only (decimal, no leading zeros, no `+`, no `-0`, no
//!     exponent). Stored as their validated decimal string — equivalent to the
//!     TS bigint path, since a validated canonical integer round-trips through
//!     bigint as the identity.
//!   - Object keys: no duplicates (checked after unescaping).
//!   - Strings: no surrogate `\u` escapes; no BOM at start.
//!   - Forbidden: NaN, Infinity, fractional, exponential.
//!   - Output: keys sorted by UTF-8 byte order, minimal whitespace.

use std::collections::HashSet;

use unicode_normalization::UnicodeNormalization;

use crate::errors::{CanonicalError, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum JcsValue {
    Null,
    Bool(bool),
    /// Canonical decimal integer text (e.g. "-1", "0", "42").
    Int(String),
    Str(String),
    Array(Vec<JcsValue>),
    /// Insertion-ordered key/value pairs; serialization sorts by UTF-8 bytes.
    Object(Vec<(String, JcsValue)>),
}

impl JcsValue {
    pub fn int_i128(n: i128) -> Self {
        JcsValue::Int(n.to_string())
    }
    pub fn int_u128(n: u128) -> Self {
        JcsValue::Int(n.to_string())
    }
    pub fn string(s: &str) -> Self {
        JcsValue::Str(s.to_string())
    }
    pub fn object(pairs: Vec<(&str, JcsValue)>) -> Self {
        JcsValue::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    pub fn array(items: Vec<JcsValue>) -> Self {
        JcsValue::Array(items)
    }

    // ---- read accessors (used to navigate a parsed document, e.g. golden.json) ----

    /// Object field lookup by key. Returns `None` for non-objects or missing keys.
    pub fn get(&self, key: &str) -> Option<&JcsValue> {
        match self {
            JcsValue::Object(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Borrow the string contents, if this is a `Str`.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            JcsValue::Str(s) => Some(s),
            _ => None,
        }
    }

    /// Borrow the elements, if this is an `Array`.
    pub fn as_array(&self) -> Option<&[JcsValue]> {
        match self {
            JcsValue::Array(items) => Some(items),
            _ => None,
        }
    }
}

fn nc(code: &'static str, msg: impl Into<String>) -> CanonicalError {
    CanonicalError::noncanonical(code, msg)
}

// ============================================================================
// Parser (string -> JcsValue) with duplicate-key detection
// ============================================================================

struct JcsParser {
    chars: Vec<char>,
    pos: usize,
}

impl JcsParser {
    fn new(src: &str) -> Self {
        JcsParser {
            chars: src.chars().collect(),
            pos: 0,
        }
    }

    fn parse(&mut self) -> Result<JcsValue> {
        self.skip_whitespace();
        let value = self.parse_value()?;
        self.skip_whitespace();
        if self.pos != self.chars.len() {
            return Err(nc(
                "JCS_TRAILING_INPUT",
                format!("unexpected character at position {}", self.pos),
            ));
        }
        Ok(value)
    }

    fn parse_value(&mut self) -> Result<JcsValue> {
        self.skip_whitespace();
        let c = match self.peek() {
            Some(c) => c,
            None => return Err(nc("JCS_UNEXPECTED_EOF", "unexpected end of input")),
        };
        match c {
            '{' => self.parse_object(),
            '[' => self.parse_array(),
            '"' => Ok(JcsValue::Str(self.parse_string()?)),
            't' | 'f' => self.parse_bool(),
            'n' => self.parse_null(),
            '-' | '0'..='9' => self.parse_number(),
            _ => Err(nc(
                "JCS_UNEXPECTED_CHAR",
                format!("unexpected character at position {}: {c}", self.pos),
            )),
        }
    }

    fn parse_object(&mut self) -> Result<JcsValue> {
        self.expect('{')?;
        let mut out: Vec<(String, JcsValue)> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        self.skip_whitespace();
        if self.peek() == Some('}') {
            self.pos += 1;
            return Ok(JcsValue::Object(out));
        }
        loop {
            self.skip_whitespace();
            if self.peek() != Some('"') {
                return Err(nc(
                    "JCS_KEY_NOT_STRING",
                    format!("expected string key at position {}", self.pos),
                ));
            }
            let key = self.parse_string()?;
            if !seen.insert(key.clone()) {
                return Err(nc("JCS_DUPLICATE_KEY", format!("duplicate key {key:?}")));
            }
            self.skip_whitespace();
            self.expect(':')?;
            let value = self.parse_value()?;
            out.push((key, value));
            self.skip_whitespace();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                    continue;
                }
                Some('}') => {
                    self.pos += 1;
                    return Ok(JcsValue::Object(out));
                }
                _ => {
                    return Err(nc(
                        "JCS_EXPECTED_COMMA_OR_BRACE",
                        format!("expected ',' or '}}' at position {}", self.pos),
                    ))
                }
            }
        }
    }

    fn parse_array(&mut self) -> Result<JcsValue> {
        self.expect('[')?;
        let mut out: Vec<JcsValue> = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(']') {
            self.pos += 1;
            return Ok(JcsValue::Array(out));
        }
        loop {
            let value = self.parse_value()?;
            out.push(value);
            self.skip_whitespace();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                    continue;
                }
                Some(']') => {
                    self.pos += 1;
                    return Ok(JcsValue::Array(out));
                }
                _ => {
                    return Err(nc(
                        "JCS_EXPECTED_COMMA_OR_BRACKET",
                        format!("expected ',' or ']' at position {}", self.pos),
                    ))
                }
            }
        }
    }

    fn parse_string(&mut self) -> Result<String> {
        self.expect('"')?;
        let mut result = String::new();
        loop {
            let c = match self.peek() {
                Some(c) => c,
                None => return Err(nc("JCS_STRING_UNTERMINATED", "unterminated string")),
            };
            if c == '"' {
                self.pos += 1;
                return Ok(result);
            }
            if c == '\\' {
                self.pos += 1;
                let esc = match self.peek() {
                    Some(c) => c,
                    None => return Err(nc("JCS_BAD_ESCAPE", "trailing backslash in string")),
                };
                self.pos += 1;
                match esc {
                    '"' => result.push('"'),
                    '\\' => result.push('\\'),
                    '/' => result.push('/'),
                    'b' => result.push('\u{0008}'),
                    'f' => result.push('\u{000C}'),
                    'n' => result.push('\n'),
                    'r' => result.push('\r'),
                    't' => result.push('\t'),
                    'u' => {
                        if self.pos + 4 > self.chars.len() {
                            return Err(nc("JCS_BAD_UNICODE_ESCAPE", "truncated \\u escape"));
                        }
                        let hex: String = self.chars[self.pos..self.pos + 4].iter().collect();
                        self.pos += 4;
                        let code = u32::from_str_radix(&hex, 16).map_err(|_| {
                            nc("JCS_BAD_UNICODE_ESCAPE", format!("invalid \\u escape: \\u{hex}"))
                        })?;
                        if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                            return Err(nc(
                                "JCS_BAD_UNICODE_ESCAPE",
                                format!("invalid \\u escape: \\u{hex}"),
                            ));
                        }
                        if (0xd800..=0xdfff).contains(&code) {
                            return Err(nc(
                                "JCS_SURROGATE_ESCAPE",
                                format!("surrogate \\u escape forbidden in canonical JSON: \\u{hex}"),
                            ));
                        }
                        // code is <= 0xFFFF and not a surrogate => always a valid scalar.
                        result.push(char::from_u32(code).expect("non-surrogate BMP scalar"));
                    }
                    other => {
                        return Err(nc("JCS_BAD_ESCAPE", format!("invalid escape \\{other}")));
                    }
                }
                continue;
            }
            if (c as u32) < 0x20 {
                return Err(nc(
                    "JCS_CONTROL_IN_STRING",
                    format!("unescaped control character U+{:04x}", c as u32),
                ));
            }
            // Rust `char` cannot be a lone surrogate; raw multi-byte scalars pass through.
            result.push(c);
            self.pos += 1;
        }
    }

    fn parse_number(&mut self) -> Result<JcsValue> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        let int_start = self.pos;
        match self.peek() {
            Some('0') => {
                self.pos += 1;
            }
            Some('1'..='9') => {
                while matches!(self.peek(), Some('0'..='9')) {
                    self.pos += 1;
                }
            }
            _ => {
                return Err(nc("JCS_BAD_NUMBER", format!("invalid number at position {start}")));
            }
        }
        match self.peek() {
            Some('.') => return Err(nc("JCS_FRACTIONAL_FORBIDDEN", "fractional numbers are forbidden")),
            Some('e') | Some('E') => {
                return Err(nc("JCS_EXPONENT_FORBIDDEN", "exponential notation is forbidden"))
            }
            _ => {}
        }
        let text: String = self.chars[start..self.pos].iter().collect();
        let digit_part: String = self.chars[int_start..self.pos].iter().collect();
        if digit_part.len() > 1 && digit_part.starts_with('0') {
            return Err(nc("JCS_LEADING_ZERO", format!("numbers must not have leading zeros: {text}")));
        }
        if text == "-0" {
            return Err(nc("JCS_NEGATIVE_ZERO", "'-0' is forbidden"));
        }
        Ok(JcsValue::Int(text))
    }

    fn parse_bool(&mut self) -> Result<JcsValue> {
        if self.starts_with("true") {
            self.pos += 4;
            return Ok(JcsValue::Bool(true));
        }
        if self.starts_with("false") {
            self.pos += 5;
            return Ok(JcsValue::Bool(false));
        }
        Err(nc("JCS_BAD_LITERAL", format!("invalid literal at position {}", self.pos)))
    }

    fn parse_null(&mut self) -> Result<JcsValue> {
        if self.starts_with("null") {
            self.pos += 4;
            return Ok(JcsValue::Null);
        }
        Err(nc("JCS_BAD_LITERAL", format!("invalid literal at position {}", self.pos)))
    }

    fn starts_with(&self, literal: &str) -> bool {
        let lit: Vec<char> = literal.chars().collect();
        if self.pos + lit.len() > self.chars.len() {
            return false;
        }
        self.chars[self.pos..self.pos + lit.len()] == lit[..]
    }

    fn skip_whitespace(&mut self) {
        while let Some(c) = self.peek() {
            if matches!(c, ' ' | '\t' | '\n' | '\r') {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn expect(&mut self, c: char) -> Result<()> {
        if self.peek() == Some(c) {
            self.pos += 1;
            Ok(())
        } else {
            Err(nc(
                "JCS_EXPECTED_CHAR",
                format!(
                    "expected '{c}' at position {}, got '{}'",
                    self.pos,
                    self.peek().map(|c| c.to_string()).unwrap_or_else(|| "<EOF>".into())
                ),
            ))
        }
    }
}

// ============================================================================
// Serializer (JcsValue -> canonical string)
// ============================================================================

/// RFC 8785 §3.2.2.2 minimal string escaping, after NFC normalization.
///
/// CE §3.2: a canonical string MUST NOT begin with U+FEFF (BOM). This applies
/// to every JSON string token — keys and values alike — independent of object
/// key count. Mid-string U+FEFF (ZWNBSP) is permitted.
fn escape_string(s: &str, out: &mut String) -> Result<()> {
    if s.starts_with('\u{FEFF}') {
        return Err(nc(
            "UTF8_BOM_FORBIDDEN",
            "BOM at start of JSON string is forbidden",
        ));
    }
    crate::strings::assert_assigned(s)?;
    let normalized: String = s.nfc().collect();
    out.push('"');
    for c in normalized.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{000C}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    Ok(())
}

fn serialize(value: &JcsValue, out: &mut String) -> Result<()> {
    match value {
        JcsValue::Null => out.push_str("null"),
        JcsValue::Bool(true) => out.push_str("true"),
        JcsValue::Bool(false) => out.push_str("false"),
        JcsValue::Int(s) => out.push_str(s),
        JcsValue::Str(s) => escape_string(s, out)?,
        JcsValue::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                serialize(item, out)?;
            }
            out.push(']');
        }
        JcsValue::Object(pairs) => {
            // Sort keys by NFC UTF-8 byte order. Pure ordering — the leading-BOM
            // rejection is enforced by escape_string below (run for every key),
            // so it no longer depends on key count.
            let mut sorted: Vec<&(String, JcsValue)> = pairs.iter().collect();
            sorted.sort_by(|a, b| {
                let ab: Vec<u8> = a.0.nfc().collect::<String>().into_bytes();
                let bb: Vec<u8> = b.0.nfc().collect::<String>().into_bytes();
                ab.cmp(&bb)
            });
            out.push('{');
            for (i, (k, v)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escape_string(k, out)?;
                out.push(':');
                serialize(v, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

// ============================================================================
// Public API
// ============================================================================

/// Parse a JSON string with restricted-JCS validation and return canonical bytes.
pub fn canonicalize_string(json: &str) -> Result<Vec<u8>> {
    let parsed = JcsParser::new(json).parse()?;
    let mut out = String::new();
    serialize(&parsed, &mut out)?;
    Ok(out.into_bytes())
}

/// Serialize a typed `JcsValue` canonically into bytes.
pub fn canonicalize_value(value: &JcsValue) -> Result<Vec<u8>> {
    let mut out = String::new();
    serialize(value, &mut out)?;
    Ok(out.into_bytes())
}

/// Parse and return the typed value (for inspection / round-trip tests).
pub fn parse_canonical(json: &str) -> Result<JcsValue> {
    JcsParser::new(json).parse()
}
