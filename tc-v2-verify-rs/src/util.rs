//! Contract-agnostic codecs (base64 decode, hex). Like sha256, these are standard
//! primitives, NOT contract serializers — sharing them across Contract A and B is
//! allowed (docs/spec/tc-v2-contract-boundaries.md). They encode no field order,
//! endianness, discriminator, or envelope decision.

/// Decode standard base64 (with or without `=` padding); ignores ASCII whitespace.
pub fn b64_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &c in s.as_bytes() {
        let v: u32 = match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => continue, // skip newlines / spaces
        };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

/// Decode a hex string into bytes (lowercase or uppercase).
pub fn hex_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len() / 2);
    let mut i = 0;
    while i + 1 < b.len() {
        let hi = (b[i] as char).to_digit(16).expect("hex") as u8;
        let lo = (b[i + 1] as char).to_digit(16).expect("hex") as u8;
        out.push((hi << 4) | lo);
        i += 2;
    }
    out
}

/// Encode bytes as lowercase hex.
pub fn to_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}
