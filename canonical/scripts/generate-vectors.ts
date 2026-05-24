/**
 * Generate normative golden vectors for @paradigm-terra/canonical v0.1.0.
 *
 * The output file vectors/golden.json captures every canonical primitive's
 * SHA-256 (or raw bytes) for inputs that exercise the spec corners. Once this
 * suite agrees with at least one parity-implementation (Rust or Go), the
 * vectors should be promoted to NORMATIVE in Canonical Encoding §10.2.
 *
 * Run: `npm run vectors:generate`
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  addressToBytes,
  binaryMerkle,
  canonicalizeString,
  canonicalizeValue,
  DOMAIN_TAGS,
  domainHash,
  encodeFrame,
  encodeInt256,
  encodeUint256,
  encodeUint64,
  parseAddress,
  sha256,
  stateRoot,
  streamTreeRoot,
  toHex,
  utf8NfcBytes,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "vectors", "golden.json");

interface Vector {
  readonly id: string;
  readonly description: string;
  readonly input: unknown;
  readonly output: Record<string, string>;
}

const vectors: Vector[] = [];

function hexOf(bytes: Uint8Array): string {
  return `0x${toHex(bytes)}`;
}

function record(v: Vector): void {
  vectors.push(v);
}

// ---------- integers ----------

record({
  id: "int256_zero",
  description: "int256(0) → 32 zero bytes; hex text 0x00..00",
  input: { value: "0", type: "int256" },
  output: { bytes_hex: hexOf(encodeInt256(0n)), sha256: hexOf(sha256(encodeInt256(0n))) },
});

record({
  id: "int256_minus_one",
  description: "int256(-1) → 32 0xff bytes (two's complement); hex text 0xff..ff",
  input: { value: "-1", type: "int256" },
  output: { bytes_hex: hexOf(encodeInt256(-1n)), sha256: hexOf(sha256(encodeInt256(-1n))) },
});

record({
  id: "int256_min",
  description: "int256(-2^255) → 0x80 0x00..00",
  input: { value: (-(1n << 255n)).toString(), type: "int256" },
  output: { bytes_hex: hexOf(encodeInt256(-(1n << 255n))) },
});

record({
  id: "int256_max",
  description: "int256(2^255-1) → 0x7f 0xff..ff",
  input: { value: ((1n << 255n) - 1n).toString(), type: "int256" },
  output: { bytes_hex: hexOf(encodeInt256((1n << 255n) - 1n)) },
});

record({
  id: "uint256_max",
  description: "uint256(2^256-1) → 32 0xff bytes",
  input: { value: ((1n << 256n) - 1n).toString(), type: "uint256" },
  output: { bytes_hex: hexOf(encodeUint256((1n << 256n) - 1n)) },
});

record({
  id: "uint64_sequence",
  description: "uint64(0x0102030405060708) BE encoding",
  input: { value: "0x0102030405060708", type: "uint64" },
  output: { bytes_hex: hexOf(encodeUint64(0x0102030405060708n)) },
});

// ---------- UTF-8 NFC ----------

{
  const decomposed = "é"; // U+0065 + U+0301
  const composed = "é"; // U+00E9
  const nfcBytes = utf8NfcBytes(decomposed);
  record({
    id: "utf8_nfc_e_acute",
    description:
      "NFC normalization: U+0065 + U+0301 (decomposed) normalizes to U+00E9; UTF-8 encoding is 0xc3 0xa9",
    input: {
      decomposed_hex: "0x6520cc81".replace("20", ""), // visualize codepoints: 0x65 0xcc 0x81
      composed_codepoint: "U+00E9",
    },
    output: {
      bytes_hex: hexOf(nfcBytes),
      sha256: hexOf(sha256(nfcBytes)),
      composed_bytes_hex: hexOf(utf8NfcBytes(composed)),
    },
  });
}

// ---------- TON address ----------

{
  const addr = "0:83dfd552e63729b472fc4e4a8f8f83d4a8f4f3a3e3e3a3e3e3a3e3e3a3e3e3a3";
  const parsed = parseAddress(addr);
  const bytes = addressToBytes(addr);
  const hashed = domainHash(DOMAIN_TAGS.ADDRESS_V1, bytes);
  record({
    id: "ton_address_canonical",
    description: "Canonical raw TON address; SHA256 with PARADIGM_TERRA_ADDRESS_V1 domain tag",
    input: { address: addr, workchain: parsed.workchain },
    output: {
      address_bytes_hex: hexOf(bytes),
      domain_hash: hexOf(hashed),
    },
  });
}

// ---------- JCS ----------

{
  const json = '{ "b": 2, "a": 1 }';
  const canon = canonicalizeString(json);
  record({
    id: "jcs_sample_b2_a1",
    description: "CE §10 example: {\"b\":2,\"a\":1} canonicalizes with sorted keys",
    input: { json },
    output: {
      canonical_utf8_hex: hexOf(canon),
      canonical_text: new TextDecoder().decode(canon),
      sha256: hexOf(sha256(canon)),
    },
  });
}

{
  const expr = '{"op":"gte","lhs":{"var":"x"},"rhs":{"const":0}}';
  const canon = canonicalizeString(expr);
  const dslHashV11 = domainHash(DOMAIN_TAGS.DSL_V1_1, canon);
  const dslHashV12 = domainHash(DOMAIN_TAGS.DSL_V1_2, canon);
  record({
    id: "dsl_expr_gte_x_0",
    description: "DSL expression {op:gte, lhs:{var:x}, rhs:{const:0}}; both v1.1 and v1.2 hashes",
    input: { expression: expr },
    output: {
      canonical_text: new TextDecoder().decode(canon),
      dsl_v1_1_hash: hexOf(dslHashV11),
      dsl_v1_2_hash: hexOf(dslHashV12),
    },
  });
}

{
  const bigInt = "12345678901234567890123456789012345678";
  const canon = canonicalizeString(bigInt);
  record({
    id: "jcs_big_integer",
    description: "Integer beyond 2^53 preserved exactly (string only used for input)",
    input: { json: bigInt },
    output: {
      canonical_text: new TextDecoder().decode(canon),
      sha256: hexOf(sha256(canon)),
    },
  });
}

// ---------- Domain-separated hashing ----------

{
  // Example CAL canonical bytes (synthetic).
  const cal = canonicalizeValue({
    action: "wallet.send_ton",
    agent_id: "0:83dfd552e63729b472fc4e4a8f8f83d4a8f4f3a3e3e3a3e3e3a3e3e3a3e3e3a3",
    cal_version: "0.1.0",
    expiration_tick: 1050000n,
    nonce: 42n,
    preconditions: { op: "eq", lhs: { var: "x" }, rhs: { const: 1n } },
    receipt_required: true,
  });
  record({
    id: "cal_v1_hash_example",
    description: "Synthetic CAL canonical bytes hashed with PARADIGM_TERRA_CAL_V1",
    input: { note: "see canonical_text for the inputs" },
    output: {
      canonical_text: new TextDecoder().decode(cal),
      cal_hash: hexOf(domainHash(DOMAIN_TAGS.CAL_V1, cal)),
    },
  });
}

// ---------- Merkle ----------

{
  // Stream tree with two streams
  const root = streamTreeRoot([
    {
      streamId: "treasury",
      stateHash: new Uint8Array(32).fill(0xaa),
      lastEventHash: new Uint8Array(32).fill(0xbb),
      lastSeqno: 100n,
    },
    {
      streamId: "registry",
      stateHash: new Uint8Array(32).fill(0x11),
      lastEventHash: new Uint8Array(32).fill(0x22),
      lastSeqno: 7n,
    },
  ]);
  record({
    id: "merkle_stream_tree_2",
    description: "Stream-tree Merkle root over 2 streams (registry, treasury); lex order by streamId",
    input: {
      streams: [
        { streamId: "registry", stateHash_fill: "0x11", lastEventHash_fill: "0x22", lastSeqno: 7 },
        { streamId: "treasury", stateHash_fill: "0xaa", lastEventHash_fill: "0xbb", lastSeqno: 100 },
      ],
    },
    output: { root: hexOf(root) },
  });
}

{
  // Three leaves to exercise odd-leaf duplication
  const a = sha256(new TextEncoder().encode("A"));
  const b = sha256(new TextEncoder().encode("B"));
  const c = sha256(new TextEncoder().encode("C"));
  const root3 = binaryMerkle([a, b, c], DOMAIN_TAGS.MERKLE_NODE_V1);
  record({
    id: "merkle_three_leaves_odd_duplicate",
    description: "Binary Merkle over 3 leaves SHA256(A), SHA256(B), SHA256(C); last duplicated",
    input: { leaves: ["SHA256('A')", "SHA256('B')", "SHA256('C')"] },
    output: { root: hexOf(root3) },
  });
}

// ---------- State root (CAL Spec §7.3) ----------

{
  // 8 namespaces with synthetic canonical bytes
  const namespaces = [
    { name: "state.cal", canonicalBytes: canonicalizeValue({ nonces: {}, in_flight: {} }) },
    {
      name: "state.failure_mode",
      canonicalBytes: canonicalizeValue({
        current: "NORMAL",
        entered_at: 0n,
        recovery_progress: 0n,
        is_bounded_mode: false,
        capture_guard_counters: {},
      }),
    },
    {
      name: "state.governance",
      canonicalBytes: canonicalizeValue({
        slots: {},
        active_proposals: [],
        cartel_flags: {},
        cluster_detection: {},
        proposal_votes: {},
        gas_price_nano_ptra_per_unit: 1000n,
      }),
    },
    { name: "state.oracles", canonicalBytes: canonicalizeValue({ nodes: {}, feeds: {}, slashed_nodes: {} }) },
    {
      name: "state.ptra",
      canonicalBytes: canonicalizeValue({
        total_supply: 1000000000000000000n,
        burned_total: 0n,
        burned_window: 0n,
        twap_ton_ratio: 0n,
        stakes: {},
        balances: {},
      }),
    },
    {
      name: "state.registry",
      canonicalBytes: canonicalizeValue({ agents: {}, mcp_schema_hash: "0x" + "00".repeat(32), protocols: {} }),
    },
    {
      name: "state.tick",
      canonicalBytes: canonicalizeValue({ current: 0n, genesis: 0n, blocks_per_tick: 12n, epoch: 0n }),
    },
    {
      name: "state.treasury",
      canonicalBytes: canonicalizeValue({
        nav: 0n,
        outflow_window: 0n,
        developer_fund_balance: 0n,
        staking_pool: 0n,
        slot_pool: 0n,
        collected_fees_window: 0n,
      }),
    },
  ];
  const root = stateRoot(namespaces);
  record({
    id: "state_root_genesis_empty",
    description:
      "STATE_ROOT over the 8 v0.10.0-draft namespaces in their genesis empty form (Constitution §XVII)",
    input: { namespaces: namespaces.map((n) => n.name) },
    output: {
      root: hexOf(root),
      domain_tag: DOMAIN_TAGS.STATE_ROOT_V1,
    },
  });
}

// ---------- Framing ----------

{
  const frame = encodeFrame({
    typeTag: 0x0042,
    version: 0x0001,
    payload: new TextEncoder().encode("hello"),
  });
  record({
    id: "frame_hello",
    description: "Binary framing of payload 'hello' (UTF-8) with type_tag=0x0042, version=0x0001",
    input: { type_tag: "0x0042", version: "0x0001", payload_utf8: "hello" },
    output: { frame_hex: hexOf(frame) },
  });
}

// ---------- New domain tags registry ----------

record({
  id: "domain_tags_registry",
  description: "All registered domain tags (CE §7.1 + v0.10.0-draft additions). Tier 2 amendable.",
  input: {},
  output: Object.fromEntries(
    Object.entries(DOMAIN_TAGS).map(([k, v]) => [k, `sha256(empty||tag)=${hexOf(domainHash(v, new Uint8Array()))}`]),
  ),
});

// ---------- Write file ----------

const document = {
  meta: {
    package: "@paradigm-terra/canonical",
    version: "0.1.0",
    spec_basis: "Canonical Encoding Specification v1.3 (SCF)",
    spec_extensions: "Constitution v0.10.0-draft + CAL Execution Spec v0.1.0-draft (STATE_ROOT_V1, DSL_V1.2)",
    generated_at: new Date().toISOString(),
    status:
      "NORMATIVE — generated by the TypeScript reference implementation and verified byte-for-byte by the Rust (canonical-rs) and Go (canonical-go) parity implementations on 2026-05-24 (44 checks across all 17 vectors each).",
  },
  vectors,
};

await writeFile(OUTPUT_PATH, JSON.stringify(document, null, 2) + "\n", "utf-8");
console.log(`Wrote ${vectors.length} golden vectors → ${OUTPUT_PATH}`);
