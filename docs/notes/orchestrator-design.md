# CAL Orchestrator / Node — design notes (v0.1.0)

The orchestrator is the **integration layer** that turns the pure building blocks
([[cal-validator-design]], [[cal-reducer-design]], canonical encoding) into a
runnable node: it folds a *stream* of CALs through `validate → apply` over one
evolving `State`, advances ticks, and commits to the result via state roots and the
Canonical Encoding §6.3 global Merkle root. It is the first component that exercises
the validator and reducer **together over many CALs / agents / ticks** — the
integration surface where the §6.2 round-trip bug surfaced.

## 1. Inputs & outputs

```
run(program) → transcript
```

A **program** is an ordered list of per-tick blocks; each block carries a `tick` and
a list of `{cal, trace}` submissions (the trace is the off-chain executor's observed
step outcomes + before/after state, §4.1 — the node, like the validator, evaluates
but does not execute). The **transcript** records, per tick, each submission's
terminal stage / reason / per-event STATE_ROOTs, the end-of-tick STATE_ROOT and
global Merkle root, plus the full event log and the start state (so it replays).

## 2. The fold loop

For each submission, at the block's tick:

1. **Ingress** — emit `cal.created` then `cal.signed`. Folding these through the
   reducer is what enforces §6.1 (one in-flight CAL per agent → `AGENT_BUSY`) and CAL
   uniqueness (`DUPLICATE_CAL`); a rejection here records an `ingressError` and the
   submission is skipped (no validation).
2. **Validate** — `validate(cal, CAL_HASH, snapshot = live State, trace)`. The
   snapshot is the live reducer state; `cal.created`/`cal.signed` only add the
   in-flight record, so the fields the validator reads (nonces, balances, granted
   scopes, governance) are unaffected. The node **pins `trace.currentTick` to its own
   tick** so a submission cannot misreport the tick to dodge expiration.
3. **Apply** — fold every event the validator emits through `apply`, recording the
   STATE_ROOT after each. A validator event the reducer rejects is an integration
   defect and raises `OrchestratorError("APPLY_FAILED", …)` rather than being
   swallowed.

Between blocks the node emits `tick.advanced { new_tick }` (strictly increasing;
genesis tick is 0). This drives multi-tick behaviour: a CAL whose `expiration_tick`
is below the current tick is rejected `EXPIRED` (pre-VALIDATED), and the bounded-mode
counter is recomputed (§10.1, via the reducer).

## 3. Nonce streams (§6.2)

Each terminal transition bumps `nonces[agent_id]`; a CAL must carry
`nonces[agent_id] + 1` at VALIDATED or it fails `NONCE_MISMATCH`. The node makes this
observable across a stream: e.g. a `PRECOND_FALSE` still burns the nonce, so the next
CAL must use the following nonce. Agents are independent (separate nonce streams).

## 4. Global Merkle root (CE §6.3)

Computed at the end of each tick over the canonical stream list. v0.1.0 models the
node as a **single** stream `"global"`:

```
leaf = { stream_id: "global",
         state_hash:      STATE_ROOT(State),
         last_event_hash: EVENT_HASH(last event in the log),   // 32 zero bytes if none
         last_seqno:      uint64(event count) }
global_root = binary_merkle([leaf], "PARADIGM_TERRA_MERKLE_NODE_V1")
```

The constitution's fixed multi-stream list (CE §6.2) drops in here later by emitting
one leaf per stream; the leaf format and ordering are already the CE §6.3 ones.

## 5. Replay-determinism (§7.2)

The reducer is pure and total, so re-folding the recorded event log from the start
state reproduces every STATE_ROOT. `verifyReplay(transcript)` checks the replayed
final root and each end-of-tick checkpoint match what the run recorded.

## 6. Scope (v0.1.0) & deferred

Reachable: FINALIZED, every pre-VALIDATED and post-VALIDATED failure class,
EXPIRED_PRE, multi-agent / multi-tick, bounded-mode flip.

**Deferred — needs a staged validator.** `validate()` is atomic (one `currentTick`,
and every CAL reaches a terminal event within the call), so two states are
unreachable by orchestration alone:

- **EXPIRED_POST** — validated at T0, then the tick passes `expiration_tick` before
  execution/finalization. Requires splitting the lifecycle across ticks
  (validate-to-VALIDATED at T0; execute + finalize at T1).
- **AGENT_BUSY** — a second CAL for an agent whose previous CAL has not terminated.

Both become reachable once the validator exposes staged entry points; that is the
next increment. Replay-divergence → `CONSENSUS_UNCERTAINTY` and the wider
failure-state machine are tracked separately.

## 7. Module layout & golden plan

```
orchestrator/   (TypeScript reference, @paradigm-terra/orchestrator)
  src/ node.ts   (run / replay / verifyReplay + types)
       index.ts
  scripts/ programs.ts          (shared golden programs — one source of truth)
           generate-vectors.ts
  test/ node.test.ts            (behavioural)
        golden-vectors.test.ts  (re-runs the shared programs against the golden)
```

Golden vectors pin, per program: the canonical start state + each submission's
canonical CAL and trace, and the expected event log, per-tick STATE_ROOT + global
Merkle root, per-submission terminal stage / reason / per-event roots, and the final
root. Status **PRE-NORMATIVE** until the Rust + Go ports reproduce every value
byte-for-byte (then promote to NORMATIVE, as with every prior layer).
