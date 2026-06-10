# Release notes — v1.1.0 (2026-06-10)

**The jetton publication release.** Adds `wallet.send_jetton` end-to-end, on the **same** PFC-1 freeze
line (`pfc1-consensus-freeze`). MINOR per SemVer: a new operational capability **above** the Freeze
Surface — `freeze-gate` (`vectors-check` + `verify-proof-ts` + `verify-proof-go`) stayed **byte-identical**
through every PR, so the frozen consensus core is unchanged from v1.0.0.

## Headline

You can now publish a `wallet.send_jetton` action: a CAL → the W5 external carrying a standard **TEP-74**
jetton transfer → an on-chain jetton movement, proven live on ton-testnet.

## What shipped (J1 track)

- **J1-A — codec.** `canonical_to_inner` gained a `send_jetton` encoder (the TEP-74 transfer body), with
  the ⊆ authorization rule on both the jetton amount and the attached TON, deterministic normalization
  defaults, and an explicit (never auto-generated) `query_id`.
- **J1-B — serialization.** `ir_to_boc` serializes the TEP-74 body to a W5 cell and round-trips it exactly.
- **J1-C — Proof Package #3 (live).** Against the **official** standard jetton (vendored + compiled with
  pinned func-js, pre-validated offline in `@ton/sandbox`), a real testnet transfer moved exactly **250**
  jetton units: recipient `0 → 250`, operator `1000 → 750`. Settlement correlated in the M2 reconciliation
  registry. Verdict **SETTLED**.

## The reclassification (why this is v1.1.0, not v2.0.0)

`wallet.send_jetton` was first scoped as Tier C (a new freeze line). Grounding in the code showed the
consensus surface **already finalizes** the verb (it was registered in §2.3 with the frozen `jetton_access`
scope; validator/reducer/gas are generic). So jetton is a **publication-layer (Tier M)** feature — no
freeze movement, no regenerated consensus vectors. Full audit trail:
`docs/notes/pfc2-jetton-reclassification.md`. A genuine PFC-2 → v2.0.0 is **reserved for Multisig v2.1**
(which actually changes the authorization model).

## Compatibility / scope

- **No Freeze Surface change.** The base CAL authorization model (single-owner, nonce/seqno,
  single-in-flight) is untouched. v1.1.0 is byte-identical to v1.0.0 on the frozen core.
- **Out of scope (Non-goals):** nft (TEP-62), Multisig v2.1, SBT, jetton mint/burn, jetton
  administration, `custom_payload` / rich `forward_payload`.

## Evidence
- `pp2/artifacts/pp3/pp3b-evidence.json` — the SETTLED package (addresses · external_message_hash ·
  tx_hash · balances before/after · M2 correlation).
- `docs/notes/pp3-b-gate.md` — the pre-broadcast Gate. `docs/notes/j1-jetton-publication-charter.md` — the charter.

## Related
- `CHANGELOG.md` [1.1.0]; `docs/notes/release-notes-v1.0.0.md` (the inaugural release this follows).
- `docs/notes/pfc2-1-send-jetton-semantics.md` — the verb semantics.
