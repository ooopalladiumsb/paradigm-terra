//! Byte-for-byte digest parity against the TypeScript reference golden vectors
//! (`../spec/vectors/tc_v2_sig_verify_v1/`). For every vector with
//! `digest_from_input: true`, the Rust contract digest must equal the committed
//! `expect.digest_sha256_hex`. The one construction-override negative
//! (wrong-hash-layer) is excluded by design — its signed digest is not derivable
//! from the contract over the input (verdict axis only, covered by TS/Go).
//!
//! No JSON dependency (house policy): a tiny std-only extractor reads the flat
//! scalar fields from these machine-generated vector files.

use paradigm_terra_tc_v2_verify::sign_data::{sign_data_digest, Payload, SignDataInput};
use paradigm_terra_tc_v2_verify::ton_proof::{ton_proof_digest, TonProofInput};
use paradigm_terra_tc_v2_verify::util::{hex_decode, to_hex};

const VECTORS: &[&str] = &[
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/positive/tonkeeper-binary.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/positive/tonkeeper-text.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/positive/mytonwallet-binary.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/positive/mytonwallet-text.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/positive/mytonwallet-tonproof.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/positive/tonkeeper-tonproof.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/signature-bit-flip.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/timestamp-plus-one.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/timestamp-minus-one.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/wrong-domain.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/wrong-pubkey.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/wrong-payload.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/negative/wrong-discriminator.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/cross-channel/signdata-under-tonproof-verifier.json")),
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors/tc_v2_sig_verify_v1/cross-channel/tonproof-under-signdata-verifier.json")),
];

fn raw_after<'a>(json: &'a str, key: &str) -> &'a str {
    let pat = format!("\"{key}\"");
    let i = json.find(&pat).unwrap_or_else(|| panic!("key {key} not found"));
    let rest = &json[i + pat.len()..];
    let colon = rest.find(':').expect("colon");
    rest[colon + 1..].trim_start()
}
fn jstr(json: &str, key: &str) -> String {
    let v = raw_after(json, key);
    let v = v.strip_prefix('"').unwrap_or_else(|| panic!("expected string for {key}"));
    let end = v.find('"').expect("closing quote");
    v[..end].to_string()
}
fn jint(json: &str, key: &str) -> i64 {
    let v = raw_after(json, key);
    let end = v.find(|c: char| c == ',' || c == '}' || c.is_whitespace()).unwrap_or(v.len());
    v[..end].trim().parse().expect("int")
}
fn addr32(hex: &str) -> [u8; 32] {
    hex_decode(hex).try_into().expect("32-byte address hash")
}

#[test]
fn digest_parity_with_typescript_golden_vectors() {
    let mut checked = 0;
    for j in VECTORS {
        let id = jstr(j, "id");
        let contract = jstr(j, "contract");
        let expected = jstr(j, "digest_sha256_hex");
        let wc = jint(j, "workchain") as i32;
        let addr = addr32(&jstr(j, "address_hash_hex"));
        let domain = jstr(j, "domain");
        let ts = jint(j, "timestamp") as u64;

        let digest = match contract.as_str() {
            "TC_V2_SIGNDATA_VERIFY_V1" => {
                let ptype = jstr(j, "payload_type");
                let pstr = if ptype == "text" { jstr(j, "payload_text") } else { jstr(j, "payload_b64") };
                let payload = if ptype == "text" { Payload::Text(&pstr) } else { Payload::Binary(&pstr) };
                sign_data_digest(&SignDataInput { workchain: wc, address_hash: addr, domain: &domain, timestamp: ts, payload })
            }
            "TC_V2_TONPROOF_VERIFY_V1" => {
                let pp = jstr(j, "proof_payload");
                ton_proof_digest(&TonProofInput { workchain: wc, address_hash: addr, domain: &domain, timestamp: ts, proof_payload: &pp })
            }
            other => panic!("unknown contract {other}"),
        };

        assert_eq!(to_hex(&digest), expected, "digest mismatch for {id}");
        checked += 1;
    }
    assert_eq!(checked, 15, "expected 15 digest_from_input vectors");
    println!("Rust digest parity: {checked}/15 vectors match the TypeScript reference byte-for-byte.");
}
