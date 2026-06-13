# Layer 2 — on-chain contract toolchain & suite charter

**Date:** 2026-06-13 · Branch `feat/layer2-toolchain` · Opens **Layer 2** of the post-v2.0.0 roadmap
(`post-freeze-roadmap.md`): production on-chain contracts (Tolk) + genesis. Like every prior track this
charter fixes the discipline, the toolchain reality, and the **one architectural decision that gates
everything** — BEFORE any contract is written. Mirrors `pfc2-multisig-charter.md` / `track-a-charter.md`.

## The transition this track marks

```
"Can a CAL be authorized + published?"   → ANSWERED (wallet.* verbs: send_ton/jetton/nft, v1.0.0–v2.1.0)
        ↓
"Can the protocol's STATE live on-chain  → Layer 2 (this track) — the contract suite the vision's
 as deployable contracts, not just an      genesis (SIMULATION_PREVIEW) deploys: Registry, Treasury,
 off-chain fold + an anchor?"               FailureStateManager, Capability, … + the genesis ceremony.
```

Layer 2 is the GATE for most remaining on-chain work (governance economy, oracle, PTRA all need their
contracts). Its first step is not a contract — it is the **toolchain** every contract will share.

## 1. Toolchain reality — DECIDED (the spec's "Acton" is deferred-by-constraint)

`execution-spec-v1.md §8` recommends **Acton** (a Rust CLI) for Tolk contracts. But:

- This environment is **no-C-toolchain** ([[rust-build-no-c-toolchain]]: musl-static only, no cc/sudo/
  build-scripts/proc-macros). Acton is a Rust binary with native deps — it will not build here, and there
  is no offline prebuilt path. This is the same class of constraint that made the PFC-1 **Rust node
  deferred-by-constraint** — recorded, not hidden.
- The project **already** compiles Tolk reproducibly with **`@ton/tolk-js` 1.4.1** (a WASM compiler, no C
  toolchain) — proven by `m2-registry/` (the reconciliation Registry; `npm run build` reproduces codeHash
  `62D0CA9C…` deterministically). This mirrors how `pp2` uses `@ton-community/func-js` (WASM FunC).

**Ruling: the Layer-2 Tolk toolchain is `@ton/tolk-js` (pinned), with a shared reproducible build +
golden-codeHash harness generalizing `m2-registry/scripts/build.ts`. Acton is deferred-by-constraint**
(documented; a future runner with a C toolchain may add an Acton *cross-check*, never a dependency). The
spec's recommendation is satisfied in substance: deterministic Tolk compilation with pinned-version golden
artifacts and trace-inspection tests (via `@ton/sandbox`, the PP#3/PP#5 pattern).

## 2. The architectural decision R0 surfaces (decide BEFORE the first contract) — KEY

Paradigm Terra's **consensus is off-chain and frozen**: `CAL → validator → reducer → orchestrator →
STATE_ROOT`, with on-chain **anchors** (PP#2/PP#4-B) and on-chain **publication** (W5 sends). So "deploy
the state as contracts" is NOT obviously consensus-neutral. Two coherent framings:

| Framing | What the contracts ARE | Tier / line | Risk |
|---|---|---|---|
| **A. Anchor + read-model (RECOMMENDED)** | On-chain **projections** of the frozen off-chain state: the Registry mirrors `state.registry.agents` (owners, `mcp_schema_hash`) so on-chain parties + the publication leg can verify owner-pubkeys against an immutable source; Treasury mirrors balances/NAV for settlement observation. The off-chain fold stays authoritative. Extends the m2-registry reconciliation pattern. | **Tier-M / off-consensus**, MINOR, `freeze-gate` byte-identical | low — observes/anchors, never redefines consensus |
| B. Authoritative on-chain state | The contracts BECOME the source of truth (the vision's literal genesis); the consensus boundary moves on-chain. | **Tier-C → new freeze line (PFC-3) → MAJOR**; its own charter | high — a real consensus-model change |

**RULED — Framing A RATIFIED (2026-06-13).** Consistent with everything shipped (off-chain consensus +
on-chain anchor/publication: PP#2/#3/#4/#5 all treat *truth = off-chain, chain = proof/publication/
observability*). Layer 2 stays **Tier-M, off the Freeze Surface**, and still delivers the vision's
deployable contract suite — as the *on-chain face* of the frozen protocol, not a re-platforming of
consensus. **Framing B is explicitly OUT of this track**: it would invert the founding axiom
(`off-chain consensus → on-chain projection` ⟶ `on-chain consensus state → off-chain services`) — that is
**Paradigm Terra v3 / PFC-3**, a separate program (new charter, new Freeze Surface, new golden vectors, a
fresh TS/Rust/Go parity cycle, a MAJOR), not a Layer-2 step.

### 2.1 The Layer-2 invariant (ratified, binding)

```
Layer 2 contracts MUST NOT become a source of consensus truth.
Layer 2 contracts ARE projections of frozen consensus state.
```

Per-contract, this means **reflects, never owns**:

| Contract | Projects | MUST NOT |
|---|---|---|
| **Registry**   | `state.registry.agents` (owners[], mcp_schema_hash) | manage / mutate agent identity — it mirrors, the off-chain reducer owns |
| **Treasury**   | `state.accounting` (NAV, balances, fees)            | compute accounting — it mirrors the reducer's result |
| **Governance** | `state.governance`                                  | create consensus / decide votes — it mirrors finalized governance state |

Any contract that would *manage*, *compute*, or *decide* (rather than *reflect*) has crossed into Framing
B → **stop and charter a PFC line**. This invariant is the Layer-2 analog of the Freeze Surface rule.

## 3. The shared build harness (the first deliverable)

Generalize `m2-registry`'s SC-1 into a reusable Layer-2 contract harness:

```
contracts/<name>.tolk                      Tolk source (vendored deps where standard, e.g. TEP NFT/jetton)
build via @ton/tolk-js (pinned 1.4.1) →    { contract, tolkVersion, codeHashHex, codeBoc64 }  (golden)
golden test: recompile == committed codeHash   (drift guard; the m2 SC-1 pattern)
sandbox test (@ton/sandbox): deploy + exercise the entry points + assert state  (the PP#3/PP#5 pattern)
```

Same three verification axes the rest of the repo uses (golden artifact + reproducible build + sandbox
behavior). No network, no deploy in-harness — testnet deploy is a per-contract GATED step (PP-style),
exactly as PP#2/#3/#5 gated their broadcasts.

## 4. The contract suite & order

Under Framing A (anchor/read-model), built on the shared harness, in dependency order:

```
L2.0  Shared Tolk build harness ............ M  ★ FIRST — unblocks every contract below
L2.1  Registry (read-model) ................ L  agents, owners[], mcp_schema_hash; the on-chain owner-pubkey
                                               source the publication leg verifies against. Prior art: m2-registry.
L2.2  Treasury (settlement observation) .... L  NAV / developer-fund / fee balances mirror, for reconciliation
L2.3  FailureStateManager .................. M  on-chain failure-mode mirror (NORMAL/BOUNDED/…); read-model
L2.4  Capability manager ................... M  capability-profile / scope mirror
L2.5  Genesis ceremony ..................... M  deterministic deploy of the suite (the SIMULATION_PREVIEW Tick-0)
```

Governance / Oracle / PTRA contracts are NOT in Layer 2 — they belong to Layer 3 (each likely its own
PFC freeze line if it changes consensus). Layer 2 is the **infrastructure spine** they will later sit on.

## 5. Discipline (anti-scope)

- **Framing A until explicitly changed:** Layer-2 contracts observe/anchor/serve the frozen off-chain
  consensus; they do not become its source of truth. Any contract that would redefine consensus is
  Framing B → stop, charter a PFC line.
- **Freeze Surface untouched:** `freeze-gate` byte-identical throughout (Tier-M). A Freeze-Surface defect
  surfaced here still re-opens the relevant freeze (criterion 7 permanent), but that is not Layer 2's goal.
- **Toolchain:** `@ton/tolk-js` pinned; every contract ships a golden codeHash + a reproducible-build test
  + a sandbox behavior test. No un-pinned compiler, no Acton dependency.
- **No live deploy without a gate:** each contract's testnet deploy is a separate, explicitly-authorized
  PP-style step (funded operator + key custody), never bundled into the offline build.
- **Vendor standards verbatim** where one exists (TEP contracts), as `pp2` did — never re-implement a
  standard we can vendor.

## 6. Definition of Done (Layer 2)

```
DoD-1  A reusable Tolk build harness: any contracts/<name>.tolk → pinned-compiler golden codeHash +
       drift-guard test + sandbox-behavior test, with one worked example.
DoD-2  Registry (L2.1) builds, has a golden codeHash, and a sandbox test exercising its read/write entry
       points; its relationship to state.registry is documented (Framing A read-model).
DoD-3  freeze-gate byte-identical on every Layer-2 PR (Tier-M proof).
DoD-4  A stranger can reproduce each contract's codeHash from source + the pinned compiler (repro discipline).
```

## 7. The path

```
R0   This charter (toolchain ruling + Framing A) ..................... ✅ RATIFIED 2026-06-13 (Framing A)
L2.0 Shared build harness + worked example ........................... ✅ DONE (tolk/, example-counter)
L2.1 Registry read-model (build + golden + sandbox) .................. ✅ DONE (tolk/contracts/registry.tolk)
L2.2 Treasury view (build + golden + sandbox) ........................ ✅ DONE (tolk/contracts/treasury.tolk)
L2.3 FailureStateManager view ........................................ ← NEXT — offline
…    Capability / Anchor index / genesis ............................. offline, each gated for live deploy
```

### L2.2 Treasury — Definition of Done ("Treasury observes, never settles")

The Treasury view projects `state.accounting` (NAV, developer-fund balance, collected-fees window) and is
**observational only** — it stores every figure *verbatim* (owner-gated), performs **no arithmetic**, and
never recomputes NAV, distributes fees, or executes a settlement.

```
[x] reproducible golden codeHash (40DF89F7…), pinned compiler, drift-guarded
[x] sandbox: deploy → owner snapshot write → getters read back exactly; idempotent re-write; newer overwrites
[x] invariant: STORES, does not COMPUTE — nav is verbatim, NOT derived from fund+fees (proven)
[x] invariant: non-owner write aborts 401; no settlement/compute op exists — unknown op aborts 0xffff
[ ] live testnet deploy — a separate GATED step (funded operator)
```

### L2.1 Registry — Definition of Done (observational only)

The Registry projects `state.registry` (mcp_schema_hash + agents) and **is observational only** — it
stores the off-chain-computed `AgentRecord` *verbatim* (as an opaque ref it never parses), keyed by
agent_id, written solely by the trusted off-chain publisher (`owner`). It NEVER adds/removes an agent on
its own authority, changes owners, computes a threshold, or re-derives consensus.

```
[x] reproducible golden codeHash (1ED1C543…), pinned compiler, drift-guarded (tolk build test)
[x] sandbox: deploy → owner upsert → getAgent reads the record back byte-identically
[x] sandbox: registry-wide mcp_schema_hash mirrors; re-upsert is idempotent on count
[x] invariant: a non-owner write aborts 401 (owner-gated projection)
[x] invariant: NO consensus-deriving op exists — any unknown op aborts 0xffff (reflects, never computes)
[ ] live testnet deploy — a separate GATED step (funded operator), not part of this offline increment
```

PP#4-B and PP#5-B continue to wait on a funded operator and do NOT block Layer 2 (independent tracks).

## 8. Related
- `post-freeze-roadmap.md` — Layer 2's place in the post-v2.0.0 roadmap.
- `m2-charter.md` · `m2-registry/` — the reconciliation Registry + the proven `@ton/tolk-js` build (SC-1).
- `execution-spec-v1.md §8` — the Acton recommendation this reconciles (deferred-by-constraint).
- `SIMULATION_PREVIEW.md` — the genesis (Tick-0) contract suite Layer 2 makes deployable.
- `pp3-b-gate.md` · `pp5-nft-proof.md` — the vendor→build→sandbox→gated-deploy discipline Layer 2 reuses.
