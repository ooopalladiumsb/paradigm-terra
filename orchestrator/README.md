# @paradigm-terra/orchestrator

Deterministic multi-tick **node** for Paradigm Terra. Folds a program of per-tick CAL
submissions through the full pipeline — `cal.created`/`cal.signed` (ingress) →
`validate()` → `apply()` — over one evolving `State`, recording the STATE_ROOT after
every event and the Canonical Encoding v1.3 §6.3 global stream Merkle root at the end
of each tick. The event log is byte-for-byte replayable. Pure: it consumes execution
traces and does not execute steps (CAL Exec Spec §4.1).

This is the integration layer over [`cal-validator`](../validator),
[`cal-reducer`](../cal-reducer), [`cal`](../cal) (CAL_HASH/EVENT_HASH) and
[`canonical`](../canonical) (Merkle). See
[`docs/notes/orchestrator-design.md`](../docs/notes/orchestrator-design.md).

## Usage

```ts
import { run, replay, verifyReplay, type Program } from "@paradigm-terra/orchestrator";

const program: Program = {
  genesisState,            // a reducer State (funded balances, granted scopes, …)
  ticks: [
    { tick: 0n, submissions: [{ cal, trace }, /* … */] },
    { tick: 5n, submissions: [{ cal, trace }] },
  ],
};

const t = run(program);
t.ticks[0].submissions[0].terminalStage; // "FINALIZED" | "FAILED" | "EXPIRED"
t.ticks[0].globalMerkleRoot;             // CE §6.3 root (hex) at end of tick
verifyReplay(t);                         // true — re-folding the log reproduces every root
```

## What it covers (v0.1.0)

- §6.1 per-agent serialization & §6.2 nonce streams (independent per agent)
- Multi-tick advancement (`tick.advanced`), `EXPIRED_PRE`, bounded-mode flip (§10.1)
- Every reachable terminal: `FINALIZED`, all failure classes, `EXPIRED`
- Per-event `STATE_ROOT`, per-tick CE §6.3 global Merkle root, replay-determinism (§7.2)

**Deferred** (needs a staged validator — `validate()` is atomic): `EXPIRED_POST`,
`AGENT_BUSY`. Golden vectors are **PRE-NORMATIVE** pending the Rust/Go ports.

## Scripts

```
npm test               # behavioural + golden-vector tests
npm run vectors:generate
npm run vectors:verify
```
