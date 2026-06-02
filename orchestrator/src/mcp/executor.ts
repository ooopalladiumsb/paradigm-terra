// OVT-1 — MCP executor: produces a CAL's ExecutionTrace from REAL MCP calls (not hand-asserted).
//
// This is agent-runtime, ABOVE the consensus Freeze Surface — it never touches normative code. It
// speaks MCP JSON-RPC 2.0 over a child process's stdio (newline-delimited), and for each CAL step
// invokes the mapped MCP tool, mapping the tool result to the step's CE §5 committed effects. The
// node still owns the sig booleans (verifyIngress) and the validator-local schema pin; the executor
// owns the *execution record* `{ currentTick, steps, stateBefore, stateAfter }`.
//
// OVT-1 hypotheses exercised: H1.1 (effects from real MCP calls), H1.2 (trace generated, not
// asserted), H1.3 (schemaHashHex() == the registry pin, computed from the live tools/list).

import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { computeMcpSchemaHash } from "@paradigm-terra/canonical";
import type { Json } from "@paradigm-terra/cal-validator";

/** The execution-produced portion of an ExecutionTrace (sigs + pin are node-side, added later). */
export interface ExecutionRecord {
  readonly currentTick: bigint;
  readonly steps: readonly { ok: boolean; effects: readonly Json[]; errorDetail?: string }[];
  readonly stateBefore: Json;
  readonly stateAfter: Json;
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: { effects?: Json[]; error?: string };
}

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** CAL step verb → MCP tool name. CAL verbs are dotted (`wallet.send_ton`); MCP tools are the leaf
 * identifier (`send_ton`). A bare identifier maps to itself. */
export function verbToTool(verb: string): string {
  const i = verb.lastIndexOf(".");
  return i === -1 ? verb : verb.slice(i + 1);
}

export class McpExecutor {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private tools: string[] = [];

  /** Spawn the MCP server, perform the initialize handshake, and cache the advertised tool set. */
  async connect(serverCmd: string, serverArgs: string[] = []): Promise<void> {
    this.proc = spawn(serverCmd, serverArgs, { stdio: ["pipe", "pipe", "inherit"] });
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      let msg: { id?: number; result?: unknown; error?: { message: string } };
      try { msg = JSON.parse(t); } catch { return; }
      if (msg.id === undefined) return; // notification
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ovt1-executor", version: "0.1.0" } });
    this.notify("notifications/initialized");
    const listed = (await this.request("tools/list", {})) as { tools: { name: string }[] };
    this.tools = listed.tools.map((t) => t.name);
  }

  /** MCP_SCHEMA_HASH (§4.4.1) over the live server's advertised tool set — must equal the pin. */
  schemaHashHex(): string {
    return toHex(computeMcpSchemaHash(this.tools));
  }

  advertisedTools(): readonly string[] {
    return this.tools;
  }

  /** Execute a CAL's steps against the MCP server, GENERATING the execution record. */
  async executeCal(cal: { steps: readonly { verb: string; params?: Json }[] }, opts: { currentTick: bigint; stateBefore: Json }): Promise<ExecutionRecord> {
    const known = new Set(this.tools);
    const steps: { ok: boolean; effects: readonly Json[]; errorDetail?: string }[] = [];
    for (const step of cal.steps) {
      const tool = verbToTool(step.verb);
      if (!known.has(tool)) {
        // Decided from the server's advertised list — the executor consults the server, never rubber-stamps.
        steps.push({ ok: false, effects: [], errorDetail: `UNKNOWN_TOOL:${tool}` });
        continue;
      }
      const res = (await this.request("tools/call", { name: tool, arguments: step.params ?? {} })) as ToolResult;
      const effects = res.structuredContent?.effects ?? [];
      if (res.isError) steps.push({ ok: false, effects, errorDetail: res.structuredContent?.error ?? "STEP_ERROR" });
      else steps.push({ ok: true, effects });
    }
    // §4.1: the trace's stateBefore/stateAfter are the agent's snapshots. With no committed
    // state-write effects, the after-state equals the before-state.
    return { currentTick: opts.currentTick, steps, stateBefore: opts.stateBefore, stateAfter: opts.stateBefore };
  }

  async close(): Promise<void> {
    try { this.notify("shutdown"); } catch { /* ignore */ }
    this.rl?.close();
    this.proc?.kill();
    this.proc = null;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timeout: ${method}`));
      }, 5000);
    });
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(msg: unknown): void {
    if (!this.proc) throw new Error("executor not connected");
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }
}
