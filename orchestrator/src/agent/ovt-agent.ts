// OVT-1 H1.4 — minimal autonomous OVT agent: the full client-side loop with NO manual stitching.
//
//   construct CAL → operator_sign → owner_sign → MCP-execute (trace) → submit → await FINALIZED.
//
// Agent-runtime, ABOVE the Freeze Surface. Owner signing is pluggable (`OwnerSigner`): the loop is
// autonomous in tests via `LocalTestOwnerSigner` (a byte-identical Contract A commit, produced
// programmatically — same digest a TON Connect wallet signs), and a real TON Connect signer drops
// into the same seam for H1.4-live. The point is the *loop*, not the wallet (the wallet is already
// proven by Gate #4 / Proof Package #1 with a real signature). No queues / parallelism / retry /
// persistence — that surface is OVT-2.

import crypto from "node:crypto";
import { canonicalUnsignedBytes, calHash } from "@paradigm-terra/cal";
import { genesis } from "@paradigm-terra/cal-reducer";
import { signDataDigest, type Json } from "@paradigm-terra/cal-validator";
import { run, verifyIngress } from "../index.js";
import { McpExecutor } from "../mcp/executor.js";

const toHex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");
const rawPub = (pk: crypto.KeyObject): string => {
  const d = pk.export({ type: "spki", format: "der" }) as Buffer;
  return d.subarray(d.length - 32).toString("hex");
};

export interface OwnerEnvelope {
  readonly signature: string;
  readonly domain: string;
  readonly timestamp: bigint;
  readonly workchain: bigint;
  readonly address_hash: string;
}

/** The owner-signing seam. `LocalTestOwnerSigner` makes the loop autonomous; a TON Connect signer
 * implements the same interface for H1.4-live. */
export interface OwnerSigner {
  ownerPubkeyHex(): string;
  sign(calCanonicalBytesB64: string): Promise<OwnerEnvelope>;
}

export class LocalTestOwnerSigner implements OwnerSigner {
  private kp = crypto.generateKeyPairSync("ed25519");
  private addressHashHex: string;
  private domain: string;
  constructor(opts?: { domain?: string; addressHashHex?: string }) {
    this.domain = opts?.domain ?? "ovt.local";
    this.addressHashHex = opts?.addressHashHex ?? "aa".repeat(32);
  }
  ownerPubkeyHex(): string {
    return "0x" + rawPub(this.kp.publicKey);
  }
  async sign(calCanonicalBytesB64: string): Promise<OwnerEnvelope> {
    const ts = 1780300000n;
    const digest = signDataDigest({
      workchain: 0,
      addressHashHex: this.addressHashHex,
      domain: this.domain,
      timestamp: ts,
      payload: { type: "binary", bytesB64: calCanonicalBytesB64 },
    });
    return {
      signature: toHex(crypto.sign(null, digest, this.kp.privateKey)),
      domain: this.domain,
      timestamp: ts,
      workchain: 0n,
      address_hash: "0x" + this.addressHashHex,
    };
  }
}

export interface AgentOutcome {
  readonly calHash: string;
  readonly terminalStage: string | null;
  readonly reasonCode: string | null;
  readonly operatorSigPresent: boolean;
  readonly ownerSigPresent: boolean;
  readonly stateRootAfter: string | null;
  readonly eventLogRoot: string;
  readonly events: string[];
  /** The step results came from the MCP executor, never hand-set. */
  readonly traceWasGenerated: true;
}

export class OvtAgent {
  private opKp = crypto.generateKeyPairSync("ed25519");
  private executor = new McpExecutor();
  constructor(
    private owner: OwnerSigner,
    private opts: { serverCmd: string; serverArgs: string[]; agentId?: string },
  ) {}

  operatorPubkeyHex(): string {
    return "0x" + rawPub(this.opKp.publicKey);
  }
  private agentId(): string {
    return this.opts.agentId ?? "0:" + "aa".repeat(32);
  }

  async connect(): Promise<void> {
    await this.executor.connect(this.opts.serverCmd, this.opts.serverArgs);
  }
  async close(): Promise<void> {
    await this.executor.close();
  }

  private buildCal(nonce: bigint, expirationTick: bigint = 100n) {
    const id = this.agentId();
    return {
      cal_version: "0.1.0",
      action: "wallet.send_ton",
      agent_id: id,
      nonce,
      expiration_tick: expirationTick,
      preconditions: { op: "gte", lhs: { var: `state.ptra.balances.${id}` }, rhs: { const: 1n } },
      invariants: [],
      steps: [{ verb: "wallet.send_ton", params: {}, post_conditions: [] }],
      receipt_required: true,
    };
  }

  // Node-state bootstrap: the agent is registered + funded. This is the node's provisioning, not
  // part of the autonomous action — it represents the registry the node already holds.
  private provisionGenesis() {
    const id = this.agentId();
    const g = genesis() as Record<string, any>;
    g.ptra.balances[id] = 10n ** 18n;
    g.registry.agents[id] = {
      granted_scopes: ["ton_transfer"],
      operator_pubkey: this.operatorPubkeyHex(),
      owner_pubkey: this.owner.ownerPubkeyHex(),
    };
    return g;
  }

  /** Sign a CAL: operator_sig (raw Ed25519) + owner_sig (Contract A via the owner signer). */
  private async sign(cal: ReturnType<OvtAgent["buildCal"]>, opts?: { tamperOperatorSig?: boolean }) {
    const canonical = canonicalUnsignedBytes(cal);
    const b64 = Buffer.from(canonical).toString("base64");
    let operatorSig = toHex(crypto.sign(null, Buffer.from(canonical), this.opKp.privateKey));
    if (opts?.tamperOperatorSig) operatorSig = "0x" + (operatorSig.slice(2, 4) === "00" ? "ff" : "00") + operatorSig.slice(4);
    const ownerEnv = await this.owner.sign(b64);
    return { ...cal, signatures: { operator_sig: operatorSig, owner_sig: ownerEnv } };
  }

  /** The full autonomous loop for one CAL — no manual trace assertions anywhere. */
  async runOnce(opts?: { tamperOperatorSig?: boolean }): Promise<AgentOutcome> {
    const cal = this.buildCal(1n);
    const calJson = (await this.sign(cal, opts)) as unknown as Json; // bigint-bearing CAL; the canonical layer handles it
    // MCP executor produces the trace (OVT-1 H1.1/H1.2) — the agent never hand-writes step results.
    const record = await this.executor.executeCal(cal, { currentTick: 0n, stateBefore: {} });

    // ----- node boundary: submit + await -----
    const reg = { operator_pubkey: this.operatorPubkeyHex(), owner_pubkey: this.owner.ownerPubkeyHex() };
    const verdict = verifyIngress(calJson, reg);
    const trace = { ...record, operatorSigPresent: verdict.operatorSigPresent, ownerSigPresent: verdict.ownerSigPresent };
    const t = run({ genesisState: this.provisionGenesis(), ticks: [{ tick: 0n, submissions: [{ cal: calJson, trace }] }] });
    const tick0 = t.ticks[0]!;
    const sub: any = tick0.submissions[0];
    return {
      calHash: toHex(calHash(cal)),
      terminalStage: sub.terminalStage ?? null,
      reasonCode: sub.reasonCode ?? null,
      operatorSigPresent: verdict.operatorSigPresent,
      ownerSigPresent: verdict.ownerSigPresent,
      stateRootAfter: sub.stateRoots[sub.stateRoots.length - 1] ?? null,
      eventLogRoot: tick0.globalMerkleRoot,
      events: sub.events.map((e: any) => e.event_type),
      traceWasGenerated: true,
    };
  }

  /** The node-provisioning genesis (agent registered + funded) — for an external persistent node. */
  nodeGenesis(): Json {
    return this.provisionGenesis() as unknown as Json;
  }

  /** Build a submission (signed CAL + executor-generated trace) WITHOUT running the node — for
   * feeding a persistent node (OVT-2). `tick` is the tick the submission will land at. */
  async buildSubmission(nonce: bigint, tick: bigint): Promise<{ cal: Json; trace: Json }> {
    const cal = this.buildCal(nonce);
    const calJson = (await this.sign(cal)) as unknown as Json;
    const record = await this.executor.executeCal(cal, { currentTick: tick, stateBefore: {} });
    const reg = { operator_pubkey: this.operatorPubkeyHex(), owner_pubkey: this.owner.ownerPubkeyHex() };
    const verdict = verifyIngress(calJson, reg);
    return { cal: calJson, trace: { ...record, operatorSigPresent: verdict.operatorSigPresent, ownerSigPresent: verdict.ownerSigPresent } as unknown as Json };
  }

  /** Mint a submission WITHOUT the MCP round-trip, using the OVT-1-proven trace shape directly.
   * For throughput in OVT-SG state-growth measurement (the executor trace-generation path is
   * validated separately in OVT-1; SG measures the node, not the executor). */
  async mintSubmissionFast(nonce: bigint, tick: bigint, expirationTick?: bigint): Promise<{ cal: Json; trace: Json }> {
    const cal = this.buildCal(nonce, expirationTick);
    const calJson = (await this.sign(cal)) as unknown as Json;
    const reg = { operator_pubkey: this.operatorPubkeyHex(), owner_pubkey: this.owner.ownerPubkeyHex() };
    const verdict = verifyIngress(calJson, reg);
    const trace = {
      currentTick: tick,
      steps: [{ ok: true, effects: [] }],
      stateBefore: {},
      stateAfter: {},
      operatorSigPresent: verdict.operatorSigPresent,
      ownerSigPresent: verdict.ownerSigPresent,
    };
    return { cal: calJson, trace: trace as unknown as Json };
  }

  /** Replay safety / nonce lifecycle: submit the SAME signed CAL at two ticks over one state. */
  async runNonceReplay(): Promise<{ first: string | null; second: string | null; secondReason: string | null }> {
    const cal = this.buildCal(1n);
    const calJson = (await this.sign(cal)) as unknown as Json;
    const record = await this.executor.executeCal(cal, { currentTick: 0n, stateBefore: {} });
    const reg = { operator_pubkey: this.operatorPubkeyHex(), owner_pubkey: this.owner.ownerPubkeyHex() };
    const verdict = verifyIngress(calJson, reg);
    const trace0 = { ...record, operatorSigPresent: verdict.operatorSigPresent, ownerSigPresent: verdict.ownerSigPresent };
    const trace1 = { ...trace0, currentTick: 1n };
    const t = run({
      genesisState: this.provisionGenesis(),
      ticks: [
        { tick: 0n, submissions: [{ cal: calJson, trace: trace0 }] },
        { tick: 1n, submissions: [{ cal: calJson, trace: trace1 }] },
      ],
    });
    const s0: any = t.ticks[0]!.submissions[0];
    const s1: any = t.ticks[1]!.submissions[0];
    return { first: s0.terminalStage ?? null, second: s1.terminalStage ?? null, secondReason: s1.reasonCode ?? null };
  }
}
