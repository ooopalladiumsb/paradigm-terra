# PFC2-0 Charter — opening the PFC-2 consensus line (v2.0.0)

> **⚠ SUPERSEDED (2026-06-10) — the Tier-C premise was FALSIFIED for jetton.** Investigation found the
> consensus surface already finalizes `wallet.send_jetton` (registry + `jetton_access` scope frozen;
> generic validator/reducer/gas), so jetton is a **Tier-M publication feature** (`j1-jetton-publication-charter.md`,
> v1.1.0), not a freeze-line change. See `pfc2-jetton-reclassification.md`. PFC-2 as a *real* new freeze
> line is **reserved for Multisig v2.1** (a genuine authorization-model change). Kept for audit trail.

**Date:** 2026-06-10 · **Status:** charter / pre-registration (no code). **Tier C — this MOVES the
Freeze Surface.** Opens a new freeze line above PFC-1 (`pfc1-consensus-freeze`, v1.0.0). Ratify before any
PFC-2 code. First verb: **`wallet.send_jetton` (TEP-74)**.

## 0. Why this exists now

The **v1.x maintenance program is COMPLETE** (M1 CI · M2 reconciliation · M3 durability · A1 soak · A2
observer-fleet — all merged, Freeze Surface byte-identical throughout). The remaining way to add product
capability is to **grow the frozen core** — which the roadmap classifies as Tier C: a new freeze line →
v2.0.0. PFC-2 is that line. It is deliberately opened *after* v1.x so the platform that carries the new
verb already has a strong reliability baseline (soak + observer fleet).

## 1. What makes PFC-2 different from everything since v1.0.0 (read this first)

Every post-release item (M1–M3, A1, A2) held one invariant: **`freeze-gate` byte-identical** — the root
values never moved. **PFC-2 inverts that.** Adding `wallet.send_jetton` changes validator / reducer / gas
/ canonical-vector **values** — that is the *point*, and it is what makes this Tier C, not Tier M. The
discipline therefore changes:

```
v1.x (Tier M):  freeze-gate VALUES unchanged  → ride pfc1-consensus-freeze, MINOR/PATCH
PFC-2 (Tier C): freeze-gate VALUES change      → a NEW freeze line, regenerated evidence, MAJOR 2.0.0
```

The CI `freeze-gate` job stays *green* only once PFC-2's evidence is **regenerated** (new vectors promoted
to NORMATIVE, a new Proof Package reproducing in TS+Go) — it asserts *internal consistency*, not equality
with PFC-1. Until that regeneration lands, PFC-2 cannot merge to `main` (branch protection holds — by
design). PFC-2 reaches `main` only as v2.0.0, with its own self-consistent freeze.

## 2. Design review — what minimal change justifies a new freeze?

A new freeze is expensive (regenerated evidence, a new freeze ruling). The first PFC-2 increment must be
the **smallest** change that delivers real capability and isolates cleanly. Candidates:

| Candidate | Capability | Surface touched | Verdict |
|---|---|---|---|
| **`wallet.send_jetton` (TEP-74)** | jetton transfers — the most-requested capability | new payload codec (nested TEP-74 body) + validator/reducer/gas for one verb + vectors | **CHOSEN** |
| `wallet.send_nft` (TEP-62) | NFT transfer | same shape, lower demand | defer (rides the same machinery once jetton lands) |
| Multisig v2.1 (`owners[]`, `threshold`) | multi-owner authorization | the **authorization model** itself — deep, high blast radius | defer (a later PFC-2 increment or its own line) |

**Ruling: `wallet.send_jetton` first.** It is the largest capability gain that does **not** change the
base CAL model (single-owner authorization, nonce/seqno, single-in-flight all unchanged); it extends the
already-proven `wallet.send_ton` send path with a nested transfer body (the `cal-to-w5-mapping-review.md`
§6.5 surface, deferred from v0.1.0). It fits a clean Proof Package #3 (a real on-chain jetton transfer),
mirroring how PP#2 proved `send_ton`. NFT and multisig are explicitly **out** of this first increment.

## 3. Scope

### IN (PFC-2, first increment)
- `wallet.send_jetton` semantics end-to-end: validator gate (capability/scope, jetton params), reducer
  effect, gas weight, canonical encoding of the TEP-74 transfer body, and the W5 OutList nested-body codec.
- Regenerated **NORMATIVE** golden vectors covering the new verb in **TS + Rust + Go** (parity).
- **Proof Package #3** — a real testnet jetton transfer (the PP#2 discipline, for `send_jetton`).
- An explicit **`pfc2-consensus-freeze`** ruling on the new surface.

### OUT (later PFC-2 increments / PFC-3)
- `wallet.send_nft`, Multisig v2.1 (`owners[]`/`threshold`), Agentic-Wallet SBT (TEP), promoting the
  M2 reconciliation contract to *normative*. Each is its own increment once jetton lands.
- Any change to the single-owner authorization envelope (that is a separate, higher-risk decision).

## 4. The PFC-2 path (mirrors the road to v1.0.0, for the new line)

```
PFC2-0  Charter (this) ......................... ratify, no code
PFC2-1  Semantic design — wallet.send_jetton ... the model: params, TEP-74 body, ⊆ rule, invariants
PFC2-2  Validator ............................... capability/scope gate + jetton-param validation
PFC2-3  Reducer ................................. the on-chain effect / state transition
PFC2-4  Vectors ................................. golden vectors → NORMATIVE
PFC2-5  TS reference + PFC2-6 Go reference ...... parity (Rust rides the same vectors)
PFC2-7  Proof Package #3 ........................ real testnet jetton transfer (gated, like PP#2-B)
PFC2    Freeze decision .......................... explicit pfc2-consensus-freeze ruling → v2.0.0
```

Each stage is its own PR with a pre-registered acceptance, exactly as M1–A2 were — but on the PFC-2 line.

## 5. Success criteria (PFC-2 first increment)

```
SC-1  send_jetton semantics defined + validated (validator + reducer + gas) — TS reference green
SC-2  cross-language parity: TS == Rust == Go on the new verb's vectors
SC-3  golden vectors for send_jetton promoted to NORMATIVE (regenerated freeze surface)
SC-4  Proof Package #3: a real on-chain jetton transfer; on-chain effect == the CAL's authorized action
SC-5  the base CAL authorization model is UNCHANGED (single-owner envelope, nonce/seqno, single-in-flight)
SC-Freeze  an explicit pfc2-consensus-freeze ruling; freeze-gate green on the REGENERATED evidence
```

Note SC-Freeze is the **inverse** of v1.x's: the values move, deliberately, and are re-frozen — not held.

## 6. Branch policy

PFC-2 code lands on a **dedicated `pfc2/*` freeze branch** (e.g. `pfc2/consensus`), NOT a `post-release/*`
maintenance branch — because it modifies the Freeze Surface and must regenerate evidence before it can be
self-consistent. This charter (docs-only, no Freeze-Surface change) merges to `main` to pre-register the
line; the code line is opened at PFC2-1. The eventual merge to `main` is the v2.0.0 release with its own
freeze, exactly as v1.0.0 merged the PFC-1 line.

## 7. Failure taxonomy

On the PFC-2 line a divergence is a **consensus-design** signal, resolved BEFORE the freeze:
- **Parity divergence** (TS≠Rust≠Go on the new verb) — a reference/codec bug; fix before promoting vectors.
- **Model contradiction** (send_jetton needs a change to the base authorization envelope) — escalates the
  scope: it is no longer a clean isolated verb → re-scope (it may belong with multisig, a separate decision).
- **PP#3 effect mismatch** (on-chain jetton effect ≠ authorized action) — a codec/semantics gap; resolved
  on the line before the freeze ruling (PP#2's B-vs-C discriminator, applied to jetton).
None of these is a defect of the *frozen v1.0.0* line — PFC-1 stands; PFC-2 is a new, parallel freeze.

## 8. Related
- `roadmap-v1.x.md` — the Tier-M/Tier-C split (PFC-2 = the Tier-C side); v1.x COMPLETE.
- `cal-to-w5-mapping-review.md` §6.5 — nested transfer bodies (`send_jetton`/`send_nft`), deferred from v0.1.0 — PFC-2 picks this up.
- `proof-package-2-spec.md` — the PP#2 pre-registration discipline PP#3 mirrors for jetton.
- `release-governance.md` — the freeze-line / freeze-adjacent governance PFC-2 obeys.
- `freeze-manifest-pfc1.md` — the PFC-1 Freeze Surface inventory PFC-2's changes are measured against.
