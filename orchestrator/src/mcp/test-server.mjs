#!/usr/bin/env node
// OVT-1 — deterministic MCP test server (real MCP JSON-RPC 2.0 over stdio, newline-delimited).
//
// A faithful double of the pinned @ton/mcp toolset: it advertises EXACTLY the tool names in
// tools/mcp/mcp-schema-v1-tools.json (so the executor's computed MCP_SCHEMA_HASH equals the
// registry pin cb133fa7…ba34), and answers tools/call deterministically. It exists so the MCP
// executor produces an ExecutionTrace from a REAL protocol exchange — not a hand-asserted trace.
// Binding to the live @ton/mcp package (network + TON backend) is a later OVT-1 sub-step; the
// protocol surface exercised here is identical.
//
// tools/call result convention: `structuredContent.effects` = the CAL state-write effects the
// action commits (CE §5). A pure external action (e.g. send_ton) commits none → effects: [].

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = JSON.parse(fs.readFileSync(path.resolve(HERE, "../../../tools/mcp/mcp-schema-v1-tools.json"), "utf8"));
const TOOLSET = new Set(TOOLS);

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

// Deterministic per-tool effect production. Pure-external actions commit no CAL state-write.
function callTool(name, _args) {
  if (!TOOLSET.has(name)) return { isError: true, structuredContent: { effects: [], error: `UNKNOWN_TOOL:${name}` } };
  // The pinned toolset is all read/query/transport tools; none commit CAL state writes in this
  // reference double, so every successful call yields effects: []. (A state-mutating tool would
  // return its CE §5 effect ops here.)
  return { isError: false, structuredContent: { effects: [] }, content: [{ type: "text", text: `${name} ok` }] };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; }
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ovt1-mcp-test-server", version: "0.1.0" } });
      break;
    case "notifications/initialized":
      break; // notification, no response
    case "tools/list":
      ok(id, { tools: TOOLS.map((name) => ({ name, description: "", inputSchema: { type: "object" } })) });
      break;
    case "tools/call":
      ok(id, callTool(params?.name, params?.arguments ?? {}));
      break;
    case "shutdown":
      ok(id, {});
      rl.close();
      break;
    default:
      if (id !== undefined) err(id, -32601, `method not found: ${method}`);
  }
});
