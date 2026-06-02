# Operational Validation Track (OVT) — phase charter

**This is not a development roadmap. It is an operational program of hypothesis validation.**
Each item below is a *claim to be falsified by a test*, not a feature to ship. If OVT drifts into a
feature backlog, the freeze loses meaning — so the scope boundary (§4) is part of the contract.

**Core thesis:**

> PFC-1 proved **core correctness**. OVT must prove **operational correctness**.

## The two-phase contract

```
Phase A — Consensus Freeze Surface   (PFC-1; immutable core)
        ↓
Operational Validation Track         (this document; proves operation, not math)
        ↓
Production Readiness                 (later phase; features, audits, standardization)
```

PFC-1 stays an unchanging kernel. All further work gets its own space to develop **without
pressure on the consensus layer**. OVT lives strictly *above* the Freeze Surface: nothing here may
edit `canonical` / `dsl` / `cal` / `validator` / `reducer` / gas normative code.

## Freeze Surface — axioms (do NOT re-test)

These are proven and treated as **given** by OVT:

- CAL canonicalization · DSL semantics · gas accounting · Contract A (signData) · Contract B
  (tonProof) · validator · reducer · TS↔Go parity · Proof Package #1.

The **only** legitimate interaction OVT has with the Freeze Surface is to *falsify* one — i.e.
discover a defect under operation. That is not a failure of OVT; it is OVT doing its job, and it
triggers a Freeze revision (§5). OVT must never *re-prove* an axiom (that is wasted motion), only
*exercise the system that rests on them*.

---

## OVT-1 — Runtime Correctness

> **Hypothesis:** an agent can autonomously produce a valid CAL **without manual assertions**.

| Sub-hypothesis | Falsified if… | Gap# | Status |
|---|---|---|---|
| H1.1 An MCP executor produces effects from real MCP calls | any effect must be hand-written | 1 | ✅ done |
| H1.2 The `ExecutionTrace` is *generated*, not asserted | any trace field (`ok`, effects, state) must be hand-set | 1 | ✅ done |
| H1.3 `MCP_SCHEMA_HASH` pins against a real `@ton/mcp` schema | a real schema does not produce the pinned hash, or a mismatch fails to raise `SCHEMA_MISMATCH` | — | 🟡 seed (vs faithful double) |
| H1.4 The agent loop runs construct → `operator_sig` (programmatic) → `owner_sig` (TON Connect) → submit → finalized, with nonce/expiration/retry | the loop cannot complete a real action without human stitching | 4 | ⬜ open |

**Layer falsification test:** replace the hand-built trace in Proof Package #1 with an
executor-generated one — the CAL must still reach `FINALIZED` with **identical roots**. This closes
the honest boundary "trace step-results are the agent's claim."

**Status (2026-06-02): layer test PASSES.** `orchestrator/src/mcp/executor.ts` (the MCP executor,
real MCP JSON-RPC 2.0 over stdio) + `orchestrator/src/mcp/test-server.mjs` (a deterministic double
faithful to the pinned 40-tool set). `scripts/repro.sh ovt1` re-derives Proof Package #1 with an
**executor-generated** trace → `FINALIZED` with byte-identical `cal_hash` / state roots / event-log
Merkle root (H1.2); the executor's `MCP_SCHEMA_HASH` computed from the live `tools/list` equals the
registry pin `cb133fa7…ba34` (H1.3 seed); an unknown verb is rejected from the server's advertised
list (H1.1, negative control — proves the executor consults the server, not a rubber stamp).
Remaining for OVT-1: H1.3 against the live `@ton/mcp` package (needs network + TON backend) and H1.4
the agent loop (operator-sign → TON Connect owner-sign → submit → poll, with nonce/expiration/retry).

---

## OVT-2 — Operational Correctness

> **Hypothesis:** the node is a **process**, not a function.

| Sub-hypothesis | Falsified if… | Gap# |
|---|---|---|
| H2.1 A long-running node accepts submissions (mempool) and advances ticks on a clock | only the batch `run()` fold works | 3 |
| H2.2 State + event log persist across restart | state lives only in memory | 3 |
| H2.3 The node replays from the event log to current state | replay diverges from the live state | 3 |
| H2.4 Crash recovery (kill mid-tick) | recovery loses or duplicates events | 3 |
| H2.5 Re-fold is deterministic | two folds of the same log differ | 3 |

**Headline test (must pass repeatably):**

```
crash → replay → same STATE_ROOT
```

When this holds stably, the node earns *operational* trust, not just *mathematical* trust.

---

## OVT-3 — Ecosystem Correctness

> **Hypothesis:** the system is correct **outside the lab**.

| Sub-hypothesis | Falsified if… | Gap# |
|---|---|---|
| H3.1 **Proof Package #2** — on-chain testnet leg (`sendTransaction` via W5 + Annex F codec) | the finalized effect cannot be published; `tx_hash` stays null | 2 |
| H3.2 Soak: TS node == Go node over a **live stream** for hours | any divergence over continuous operation | 6 |
| H3.3 Parity is *continuous*, not point-wise | roots match on golden vectors but drift under live load | 6 |
| H3.4 Griefing: economics **bound** the attack as predicted | a flood of malformed/expensive CALs is not contained by gas/escrow/spam-fee | 5 |
| H3.5 An external observer reproduces a live node's root independently | the root cannot be verified without insider state | 7 |

H3.4 also feeds `PATH_SEGMENT_WEIGHT_REVIEW`: it yields the empirical griefing data that decides
whether weight 2 is a needed anti-grief bound or an over-weight.

---

## OVT-SG — State Growth Validation (gap #8; cross-cutting OVT-2 / OVT-3)

> **Hypothesis:** the system stays **operable as state accumulates**. Formally correct ≠ operable
> at scale — this is the silent failure mode the other tracks miss.

Measure (not just pass/fail — record the curves):

- event-log growth rate; Merkle-tree growth;
- **replay cost at 10k / 100k / 1M events**;
- crash-recovery time as a function of log size.

**Falsified if** replay or recovery cost grows such that a node a year into operation is practically
unrecoverable / unstartable. A system that is correct but un-operable after sustained use has failed
OVT even with every other box checked.

---

## Definition of done (hard AND — all simultaneously)

OVT is **not** done when all tasks are finished. It is done when **all of these hold at once**:

1. ✅ a real executor generates the trace (not asserted) — *OVT-1*
2. ✅ `crash → replay → identical STATE_ROOT`, repeatably — *OVT-2*
3. ✅ ≥1 testnet Proof Package (#2), `tx_hash ≠ null` — *OVT-3*
4. ✅ TS and Go pass a long soak with **zero** divergence — *OVT-3*
5. ✅ an external observer reproduces results independently — *OVT-3*
6. ✅ state-growth curves keep replay/recovery practical at scale — *OVT-SG*
7. ✅ **no Freeze Surface defect found during OVT**

Criterion **7 is the most important.** If OVT *does* surface a Freeze-Surface defect, OVT has
succeeded — and the Freeze must be revisited rather than promoted. This is exactly the observation
the calendar quiet period was a hollow proxy for.

## Relationship to Gate #5

OVT **replaces the calendar-only freeze criterion.** A minimum 5-day cooling-off period remains as a
procedural safeguard, but freeze promotion is gated by the OVT Definition of Done rather than elapsed
time alone. The freeze stops being "N days elapsed while nobody watched" and becomes "N units of real
operational observation with zero new contradictions."

## Explicitly out of OVT scope (anti-backlog clause)

These belong to **Production Readiness** (the phase *after* OVT), never to OVT itself:

- new protocol features; contracts beyond what the on-chain leg strictly needs; performance
  optimizations; multi-owner / Multisig v2.1; TEP standardization; Tolk normative artifacts;
  Rust ingress (deferred-by-constraint — a coverage-policy decision, not an operational hypothesis).

If a proposed task is not a falsifiable operational hypothesis about the *already-built* system, it
is out of OVT.
