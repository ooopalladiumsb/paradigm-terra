# MCP schema-hash artifact

Reproducible build of `MCP_SCHEMA_HASH` per **CAL Execution Spec §4.4.1 / §4.4.2**.

Pinned upstream: [`@ton/mcp@0.1.15-alpha.16`](https://www.npmjs.com/package/@ton/mcp/v/0.1.15-alpha.16) (tarball SHA-1 `9b02a6ba20591a1ff298b2b32811f7f6e49ddb54`).

## Artifacts

| File | What |
|---|---|
| `mcp-schema-v1-tools.json` | Canonical JSON of the lex-sorted tool-name array per CE v1.3 §4 (no whitespace, no trailing newline, UTF-8). The exact bytes that get hashed. |
| `mcp-schema-v1-tools.sha256` | File-integrity SHA-256 of `mcp-schema-v1-tools.json` (NOT the protocol hash). |
| `mcp-schema-v1.hash` | Hex-encoded `MCP_SCHEMA_HASH` = `SHA256("PARADIGM_TERRA_MCP_V1" \|\| canonical_json(sorted(tool_names)))`. This is the value validators carry as the pinned constant (CAL Spec §4.4.1) and the value frozen into validator golden vectors. |

Current pinned value (2026-05-29, 40 tools):

```
MCP_SCHEMA_HASH = cb133fa73023b330edc20801adea7a8eb2c9396dd99bb8ab06122936129fba34
```

## Reproducing

```
node tools/mcp/build.mjs            # recompute and overwrite
node tools/mcp/build.mjs --verify   # recompute and exit non-zero on drift
```

The script:

1. Downloads `mcp-${PINNED_VERSION}.tgz` from the npm registry into `work/` (cached on subsequent runs).
2. Verifies the tarball SHA-1 against the pinned constant.
3. Extracts `dist/index.js`.
4. Greps `registerTool("…")` literal calls — the authoritative registration site in the @modelcontextprotocol/sdk.
5. Sorts names lexicographically (byte-wise on UTF-8).
6. Canonical-JSON-encodes the array via `@paradigm-terra/canonical` (CE v1.3 Restricted JCS).
7. Computes `domainHash(DOMAIN_TAGS.MCP_V1, canonicalBytes)` — the protocol hash.

`work/` is git-ignored (downloaded tarball + extracted tree).

## Bumping the pinned version

Tier 1/2 amendment per Constitution §6.bis. Steps:

1. Update `PINNED_VERSION` and `PINNED_TARBALL_SHA1` in `build.mjs`.
2. Run `node build.mjs` (no `--verify`) to regenerate all three artifacts.
3. Update the `MCP_SCHEMA_HASH` constant in:
   - `validator/src/...` (pinned validator config)
   - `validator/vectors/golden.json` (the `mcp_schema_hash_*` vectors)
   - `validator-rs/` and `validator-go/` (parity ports)
4. Run cross-language parity tests.
5. Reflect the new version in CAL Spec §4.4.2 and this README.

If the new tool set differs from the previous one (rename / addition / removal), the `mcp-schema-v1-tools.json` diff is the auditable record of the change.

## Why this structure

- The `.json` artifact is the *exact* byte stream that gets hashed; reviewers can diff it across versions and immediately see tool additions/removals.
- The `.sha256` lets CI detect accidental edits to the JSON without running the full build.
- The `.hash` is what the protocol consumes; it is small and human-quotable.
- The script is `--verify`-clean so CI can guard the artifacts without a write step.
