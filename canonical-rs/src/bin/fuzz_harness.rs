//! Differential-fuzz harness for the Rust parity crate.
//!
//! Shares the line protocol documented in `fuzz/ts_harness.mjs`:
//!   stdin  : one tab-separated test case per line, all payloads hex.
//!   stdout : "OK <hex>" on success, "ERR" on any rejection, one line per input.
//!
//! No serde / JSON dependency (the proc-macro-free build policy forbids it); the
//! protocol is plain TSV, so the only dependency is `hex`, already in the tree.

use std::io::{self, Read, Write};

use paradigm_terra_canonical::addresses::address_to_bytes;
use paradigm_terra_canonical::framing::encode_frame;
use paradigm_terra_canonical::hash::domain_hash;
use paradigm_terra_canonical::integers::{encode_int256_dec, encode_uint256_dec, encode_uint64};
use paradigm_terra_canonical::jcs::canonicalize_string;
use paradigm_terra_canonical::merkle::binary_merkle;
use paradigm_terra_canonical::strings::utf8_nfc_bytes;

fn h2b(h: &str) -> Option<Vec<u8>> {
    hex::decode(h).ok()
}

fn h2s(h: &str) -> Option<String> {
    String::from_utf8(h2b(h)?).ok()
}

fn handle(line: &str) -> Option<Vec<u8>> {
    let f: Vec<&str> = line.split('\t').collect();
    let arg = |i: usize| -> Option<&str> { f.get(i).copied() };
    match *f.first()? {
        "int256" => encode_int256_dec(&h2s(arg(1)?)?).ok().map(|a| a.to_vec()),
        "uint256" => encode_uint256_dec(&h2s(arg(1)?)?).ok().map(|a| a.to_vec()),
        "uint64" => {
            let n: u64 = h2s(arg(1)?)?.parse().ok()?;
            Some(encode_uint64(n).to_vec())
        }
        "nfc" => utf8_nfc_bytes(&h2s(arg(1)?)?).ok(),
        "jcs" => canonicalize_string(&h2s(arg(1)?)?).ok(),
        "address" => address_to_bytes(&h2s(arg(1)?)?).ok(),
        "frame" => {
            let tt: u32 = arg(1)?.parse().ok()?;
            let vv: u32 = arg(2)?.parse().ok()?;
            if tt > 0xffff || vv > 0xffff {
                return None;
            }
            let payload = match arg(3) {
                Some(h) => h2b(h)?,
                None => Vec::new(),
            };
            encode_frame(tt as u16, vv as u16, &payload).ok()
        }
        "merkle" => {
            let tag = h2s(arg(1)?)?;
            let field = arg(2).unwrap_or("");
            let mut leaves: Vec<[u8; 32]> = Vec::new();
            if !field.is_empty() {
                for lh in field.split(',') {
                    let lb = h2b(lh)?;
                    if lb.len() != 32 {
                        return None; // wrong-length leaf: all impls reject
                    }
                    let mut a = [0u8; 32];
                    a.copy_from_slice(&lb);
                    leaves.push(a);
                }
            }
            binary_merkle(&leaves, &tag).ok().map(|a| a.to_vec())
        }
        "domain_hash" => {
            let tag = h2s(arg(1)?)?;
            let payload = match arg(2) {
                Some(h) => h2b(h)?,
                None => Vec::new(),
            };
            domain_hash(&tag, &payload).ok().map(|a| a.to_vec())
        }
        _ => None,
    }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let stdout = io::stdout();
    let mut w = io::BufWriter::new(stdout.lock());
    for line in input.split('\n') {
        if line.is_empty() {
            continue;
        }
        match handle(line) {
            Some(b) => writeln!(w, "OK {}", hex::encode(&b)).unwrap(),
            None => writeln!(w, "ERR").unwrap(),
        }
    }
}
