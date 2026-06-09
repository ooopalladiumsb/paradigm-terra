#!/usr/bin/env node
// Reproducible build of MCP_SCHEMA_HASH per CAL Execution Spec §4.4.1.
//
// Inputs:
//   1. The published npm tarball of @ton/mcp at the pinned version (§4.4.2).
//   2. The @paradigm-terra/canonical reference implementation (CE v1.3).
//
// Outputs:
//   tools/mcp/mcp-schema-v1-tools.json   — canonical JSON of the sorted name array
//   tools/mcp/mcp-schema-v1-tools.sha256 — SHA-256 of the JSON file (file integrity)
//   tools/mcp/mcp-schema-v1.hash         — hex(MCP_SCHEMA_HASH) per §4.4.1
//
// Run modes:
//   node build.mjs            — recompute and overwrite artifacts
//   node build.mjs --verify   — recompute and exit non-zero on drift

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeValue, domainHash, DOMAIN_TAGS } from "../../canonical/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PINNED_VERSION = "0.1.15-alpha.16";
const PINNED_TARBALL_URL = `https://registry.npmjs.org/@ton/mcp/-/mcp-${PINNED_VERSION}.tgz`;
const PINNED_TARBALL_SHA1 = "9b02a6ba20591a1ff298b2b32811f7f6e49ddb54";

const WORK_DIR = resolve(__dirname, "work");
const TARBALL_PATH = resolve(WORK_DIR, `mcp-${PINNED_VERSION}.tgz`);
const EXTRACTED_INDEX_JS = resolve(WORK_DIR, "package/dist/index.js");

const TOOLS_JSON_PATH = resolve(__dirname, "mcp-schema-v1-tools.json");
const TOOLS_SHA256_PATH = resolve(__dirname, "mcp-schema-v1-tools.sha256");
const HASH_PATH = resolve(__dirname, "mcp-schema-v1.hash");

async function ensureTarball() {
  await mkdir(WORK_DIR, { recursive: true });
  let buf;
  try {
    buf = await readFile(TARBALL_PATH);
  } catch {
    const res = await fetch(PINNED_TARBALL_URL);
    if (!res.ok) throw new Error(`tarball fetch failed: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(TARBALL_PATH, buf);
  }
  const sha1 = createHash("sha1").update(buf).digest("hex");
  if (sha1 !== PINNED_TARBALL_SHA1) {
    throw new Error(`tarball sha1 mismatch:\n  expected ${PINNED_TARBALL_SHA1}\n  got      ${sha1}`);
  }
  return buf;
}

async function extractIndexJs() {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("tar", ["-xzf", TARBALL_PATH, "-C", WORK_DIR, "package/dist/index.js"], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`tar exit ${r.status}`);
  return readFile(EXTRACTED_INDEX_JS, "utf8");
}

function extractToolNames(indexJs) {
  // The @modelcontextprotocol/sdk registration call is `.registerTool("<name>", ...)`.
  // We match the literal string argument; tool names are restricted to
  // [a-zA-Z0-9_] per the MCP spec, so the regex is unambiguous.
  const seen = new Set();
  const re = /registerTool\("([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(indexJs)) !== null) seen.add(m[1]);
  if (seen.size === 0) throw new Error("no registerTool() calls found in dist/index.js");
  return [...seen].sort();
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

async function main() {
  const verify = process.argv.includes("--verify");

  await ensureTarball();
  const indexJs = await extractIndexJs();
  const tools = extractToolNames(indexJs);

  // Canonical JSON of the sorted name array — the exact byte-sequence hashed.
  const canonicalBytes = canonicalizeValue(tools);
  const canonicalJsonText = Buffer.from(canonicalBytes).toString("utf8");

  // Protocol-level MCP_SCHEMA_HASH per §4.4.1.
  const hashBytes = domainHash(DOMAIN_TAGS.MCP_V1, canonicalBytes);
  const hashHex = bytesToHex(hashBytes);

  // File integrity sha256 of the JSON artifact itself (NOT the protocol hash).
  const fileSha256 = createHash("sha256").update(canonicalBytes).digest("hex");

  const summary = {
    pinnedVersion: PINNED_VERSION,
    pinnedTarballSha1: PINNED_TARBALL_SHA1,
    domainTag: DOMAIN_TAGS.MCP_V1,
    toolCount: tools.length,
    mcpSchemaHashHex: hashHex,
    toolsJsonSha256: fileSha256,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (verify) {
    const have = {
      tools: await readFile(TOOLS_JSON_PATH).then((b) => b.toString("utf8")).catch(() => ""),
      sha:   (await readFile(TOOLS_SHA256_PATH, "utf8").catch(() => "")).trim(),
      hash:  (await readFile(HASH_PATH, "utf8").catch(() => "")).trim(),
    };
    const expected = {
      tools: canonicalJsonText,
      sha:   `${fileSha256}  mcp-schema-v1-tools.json`,
      hash:  hashHex,
    };
    let ok = true;
    for (const k of ["tools", "sha", "hash"]) {
      if (have[k] !== expected[k]) {
        console.error(`DRIFT: ${k}\n  on-disk: ${have[k]}\n  recomputed: ${expected[k]}`);
        ok = false;
      }
    }
    process.exit(ok ? 0 : 1);
  }

  await writeFile(TOOLS_JSON_PATH, canonicalBytes);
  await writeFile(TOOLS_SHA256_PATH, `${fileSha256}  mcp-schema-v1-tools.json\n`);
  await writeFile(HASH_PATH, `${hashHex}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
