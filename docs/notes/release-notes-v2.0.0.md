# Release notes — v2.0.0 (Multisig v2.1)

**Date:** 2026-06-12 · **Freeze line:** `pfc2-consensus-freeze` (ruled 2026-06-12) · **Tag:** `v2.0.0`

The first **MAJOR** release. v2.0.0 ships **Multisig v2.1** — a real authorization-model change — on a
**new freeze line** (PFC-2), the first release that does not ride PFC-1. PFC-1 (v1.x) stands unchanged
beneath it.

## Why MAJOR

Per `release-governance.md`, the version axis is decided by the freeze line, not by taste. PFC-2 moves the
**authorization model**: the validator's single-owner gate becomes an **M-of-N quorum**, and the registry
record grows from `owner_pubkey` to `owners[] + threshold`. That touches the Freeze Surface, so it cannot
ride the 1.x line — it is its own freeze (`pfc2-consensus-freeze`) and its own MAJOR.

## What moved (Tier-C, re-frozen)

- **Validator §8.2** — single-owner → M-of-N quorum (`QUORUM_NOT_MET` / `INVALID_SIGNATURE_SET`), pure
  over `ownerSigners`.
- **Registry** — `owners[] + threshold`; v1→1-of-1 migration; §1.1 bounds; `BAD_OWNER_RECORD`.
- **Gas §9.2** — `+ ownerAuthUnits(k)` on owner-required actions; the operator path stays byte-identical to v1.
- **Vectors** — `validator/vectors/golden.json` NORMATIVE, 30 vectors, TS == Rust == Go byte-for-byte,
  incl. SC-4 `migrated 1-of-1 == v1`.

## How it was proven

- **Cross-language parity** (M5/M6/M7): TS == Rust == Go on all 30 vectors.
- **Offline authorization proof** (M8-R1): quorum 2-of-3 → FINALIZED + anchor; sub-threshold 1-of-3 →
  `QUORUM_NOT_MET`, real Ed25519 envelopes.
- **PP#4-B on-chain anchor** (ton-testnet): the quorum-finalized STATE_ROOT `0x4a14…d4f0` anchored in tx
  `7aaabb93ce1e4fd73bac455be6a0b51e02356a8bebd7f323e65db625b9c6f786`; the on-chain message body is
  **byte-identical** to the pinned anchor cell (`pp2/src/anchor-body.ts`); SC-1…SC-5 all pass
  (`pp2/artifacts/pp4/pp4b-evidence.json`).

## Scope / limits

- The on-chain demonstration is an **anchor** (a public, immutable commitment of the quorum-finalized
  consensus STATE_ROOT), not a full multi-owner W5 settlement contract. The authorization *logic* is the
  frozen, proven surface; the anchor ties it to ton-testnet.
- Unchanged from PFC-1: operator signature model, non-owner-gated actions, the canonical/dsl/cal/reducer
  core beyond the `owners[]` record + quorum gate, jetton/nft (Tier-M, v1.1.0).
- Network/product readiness beyond the anchor remains a separate track; v2.0.0 freezes the **consensus**
  surface, not mainnet/product readiness (mirrors the PFC-1 framing).

## Provenance note

During PP#4-B the operator first reported tx `75993d12…` — an earlier 1-nanoton empty self-transfer (wallet
deploy/test), not the anchor. "Inspect before classifying" (PP#2 §3.1) caught the mismatch and located the
genuine anchor (`7aaabb93…`) among the operator's transactions before any status flip. No settlement was
recorded against the wrong tx.

## Pointers

- Freeze manifest / ruling: `docs/notes/pfc2-consensus-freeze-draft.md`
- Charter + semantics: `docs/notes/pfc2-multisig-charter.md`, `pfc2-m1-multisig-semantics.md`
- Proof + gate: `docs/notes/pp4-multisig-proof.md`, `pp4-b-gate.md`
- Evidence: `pp2/artifacts/pp4/pp4b-evidence.json`
