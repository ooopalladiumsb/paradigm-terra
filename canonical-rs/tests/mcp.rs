//! Byte-for-byte parity against the TS-generated MCP schema-hash vectors.
//!
//! Loads `../tools/mcp/vectors.json` (produced by `tools/mcp/generate-vectors.mjs`
//! against the TS reference) and independently recomputes every vector with the
//! Rust crate, asserting hash bytes and error codes match.

use paradigm_terra_canonical::errors::CanonicalError;
use paradigm_terra_canonical::jcs::{parse_canonical, JcsValue};
use paradigm_terra_canonical::mcp::{
    canonicalize_mcp_tool_names, compute_mcp_schema_hash, mcp_schema_toolset_bytes,
};

const VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tools/mcp/vectors.json"
));
const PINNED_TOOLS_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tools/mcp/mcp-schema-v1-tools.json"
));

fn obj_get<'a>(v: &'a JcsValue, k: &str) -> &'a JcsValue {
    match v {
        JcsValue::Object(entries) => entries
            .iter()
            .find(|(kk, _)| kk == k)
            .map(|(_, vv)| vv)
            .unwrap_or_else(|| panic!("missing key {k}")),
        _ => panic!("not an object"),
    }
}

fn as_str(v: &JcsValue) -> &str {
    match v {
        JcsValue::Str(s) => s.as_str(),
        _ => panic!("expected string"),
    }
}

fn as_arr(v: &JcsValue) -> &[JcsValue] {
    match v {
        JcsValue::Array(xs) => xs.as_slice(),
        _ => panic!("expected array"),
    }
}

fn tool_names(v: &JcsValue) -> Vec<String> {
    as_arr(v)
        .iter()
        .map(|x| as_str(x).to_string())
        .collect()
}

#[test]
fn parity_against_ts_vectors() {
    let root = parse_canonical(VECTORS).expect("parse vectors.json");
    let vectors = as_arr(obj_get(&root, "vectors"));
    let mut total = 0usize;
    let mut fails: Vec<String> = vec![];
    for v in vectors {
        total += 1;
        let id = as_str(obj_get(v, "id"));
        let input_names = tool_names(obj_get(obj_get(v, "input"), "tool_names"));
        let expect = obj_get(v, "expect");
        let kind = as_str(obj_get(expect, "kind"));
        if kind == "ok" {
            let got_hash = match compute_mcp_schema_hash(&input_names) {
                Ok(h) => h,
                Err(e) => {
                    fails.push(format!("{id}: expected ok, got error {e}"));
                    continue;
                }
            };
            let expected_hex = as_str(obj_get(expect, "mcp_schema_hash_hex"));
            let got_hex = hex::encode(got_hash);
            if got_hex != expected_hex {
                fails.push(format!("{id}: hash mismatch\n  expected: {expected_hex}\n  got:      {got_hex}"));
            }
            // Also check canonical bytes match.
            let expected_utf8 = as_str(obj_get(expect, "canonical_bytes_utf8"));
            let got_bytes = mcp_schema_toolset_bytes(&input_names).expect("bytes");
            let got_utf8 = std::str::from_utf8(&got_bytes).expect("utf8");
            if got_utf8 != expected_utf8 {
                fails.push(format!("{id}: canonical bytes mismatch\n  expected: {expected_utf8}\n  got:      {got_utf8}"));
            }
        } else if kind == "error" {
            let expected_code = as_str(obj_get(expect, "error_code"));
            match compute_mcp_schema_hash(&input_names) {
                Ok(_) => fails.push(format!("{id}: expected error {expected_code}, got ok")),
                Err(CanonicalError { code, .. }) if code == expected_code => {}
                Err(e) => fails.push(format!("{id}: expected error {expected_code}, got {}", e.code)),
            }
        } else {
            panic!("unknown vector kind {kind}");
        }
    }
    assert!(
        fails.is_empty(),
        "ran {total} vectors, {} failure(s):\n{}",
        fails.len(),
        fails.join("\n")
    );
}

#[test]
fn pinned_artifact_matches() {
    // Reproduce the byte content of mcp-schema-v1-tools.json from the same
    // input the artifact file represents (a JSON string array). This is the
    // strongest cross-language guarantee: byte-identical canonical output.
    let parsed = parse_canonical(PINNED_TOOLS_JSON).expect("parse pinned tools.json");
    let names = tool_names(&parsed);
    let bytes = mcp_schema_toolset_bytes(&names).expect("bytes");
    assert_eq!(
        std::str::from_utf8(&bytes).unwrap(),
        PINNED_TOOLS_JSON,
        "canonical bytes of the pinned toolset must equal the on-disk artifact byte-for-byte"
    );
}

#[test]
fn canonicalize_is_idempotent_on_sorted_input() {
    let xs: Vec<String> = vec!["a_tool".into(), "b_tool".into(), "c_tool".into()];
    let sorted = canonicalize_mcp_tool_names(&xs).unwrap();
    assert_eq!(sorted, xs);
}

#[test]
fn order_independence_stress() {
    // Deterministic shuffles of the pinned 40-tool set; every permutation must
    // produce the same hash. No PRNG dep — use a simple xorshift seeded with
    // a constant so the test is reproducible.
    let parsed = parse_canonical(PINNED_TOOLS_JSON).expect("parse");
    let names = tool_names(&parsed);
    let baseline = compute_mcp_schema_hash(&names).unwrap();
    let mut state: u64 = 0x9E3779B97F4A7C15;
    for _ in 0..256 {
        // Shuffle a fresh copy.
        let mut copy: Vec<String> = names.clone();
        for j in (1..copy.len()).rev() {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let k = (state as usize) % (j + 1);
            copy.swap(j, k);
        }
        assert_eq!(compute_mcp_schema_hash(&copy).unwrap(), baseline);
    }
}
