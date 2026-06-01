# Stage 7 — TC v2 owner-sig spec-wiring inventory (planning artifact)

**Purpose.** Enumerate every place where the pre-D1 model still lives, so the atomic §8.3
normative package replaces all of it and leaves no parallel old semantics. **Not** a spec edit —
a checklist to execute the edit against. Built from a repo-wide grep (2026-06-01).

**Stage 7A review — COMPLETE (2026-06-01). Result:**
- **channel-mixing audit = CLEAN** — after the operator/owner fix (`4470539`) + the `trace.go`
  residual fix, `grep 'operator … (Contract A|signData|verifySignData)'` → NONE.
- **operator/owner separation = LOCKED** — operator raw / owner Contract A, enforced by code
  (TS+Go non-interchangeability tests), the envelope §0, and the do-not-touch list (4, 11).
- **Reference fix:** item ⑤ (Tier-2 amendment / 1000-tick window) is **§8.4**, not §8.3 L336.
- No new forks surfaced — all 11 loci are pure "carry decided rules into the normative layer."
  → cleared to execute the single atomic Tier-2 package.

**Prerequisite correction (DONE, commit `4470539`).** The Stage-6 binding layer wrongly routed
`operator_sig` through Contract A. Fixed: `operator_sig` is RAW Ed25519; only `owner_sig` is
Contract A. This inventory assumes the corrected model:

| Signature | Mechanism | Reconstruction contract | Envelope |
|---|---|---|---|
| `operator_sig` (always) | agent runtime, raw Ed25519 over `canonical_bytes(cal)` | none | no |
| `owner_sig` (conditional) | wallet, TON Connect `signData`/`binary` (D1) | Contract A | yes |

---

## 7A. Spec Wiring Inventory

Layer key: **N** = normative (`docs/spec/`), **D** = design note (`docs/notes/`), **C** = code comment.

| # | Layer | File · locus | Current (pre-D1) | New | Reason |
|---|---|---|---|---|---|
| 1 | **N** | `execution-spec-v1.md` §8.3 (owner `signMessage` line) | "`signMessage` — owner-подпись над каноническими байтами CAL … `payload.data = canonical_bytes`" (implies raw owner sig) | owner_sig is a **Contract A** `signData`/`binary` commit over `canonical_bytes`; validator reconstructs it (ref `tc-v2-sig-verify-v1`) | D1: wallet signs structured commit, not raw bytes — **owner channel only** |
| 2 | **N** | `execution-spec-v1.md` §8 carve-out (L300) | RPC list names `signMessage` first | name `signData` (TC v2); note `signMessage` is the historical TC v1 name (D2) | D2 cosmetic; avoid implying a non-existent RPC |
| 3 | **N** | `execution-spec-v1.md` §8.3 (L309) | `ton_proof` → `owner_proof_domain` | keep; add that proof verification = **Contract B** (`TC_V2_TONPROOF_VERIFY_V1`) | D1 sibling; binding routine named |
| 4 | **N** | `execution-spec-v1.md` §8.3 domain-binding (L324) | validator byte-matches `owner_sig.pubkey` vs registry | **keep** (consistent with §3A identity anchor) | no change — already correct |
| 5 | **N** | `execution-spec-v1.md` §8.3 (L336) | "changes to `signMessage.payload` format = Tier-2 amendment, 1000-tick window" | update field name; **this package IS that Tier-2 amendment** | governance: see 7D |
| 6 | **D** | `ton-connect-ingress-design.md` §3 (L59) | "for `signMessage(binary)` the spec mandates **raw-byte signing**" | owner channel = Contract A commit; raw-byte verify applies to `operator_sig` only | stale for owner |
| 7 | **D** | `ton-connect-ingress-design.md` (L17/40/188) | `signMessage(canonical_bytes(CAL))` flow | `signData`/`binary`; multisig co-signers each via owner Contract A or operator-raw as applicable | D2/D3 wording |
| 8 | **D** | `cal-validator-design.md` §8.1 / §10.2 (L97-98) | "real Ed25519 verification … deferred" | landed: operator raw, owner Contract A (`owner-sig.ts` / `owner_sig.go`); §10.2 pubkey-match unchanged | curve arithmetic now lands |
| 9 | **C** | `validator/src/validate.ts` L189-191 | "Real Ed25519 curve verification is deferred" | verdicts produced upstream by `owner-sig.ts` (operator raw / owner Contract A); `validate()` stays pure over booleans | comment now stale |
| 10 | **C** | `cal-validator-go/validate.go` (same locus) | same | same | same |
| 11 | **N/keep** | `execution-spec-v1.md` (operator key, via `cal-execution-spec` §8.1 L440) | "`operator_sig` … raw Ed25519 over canonical bytes; no external ingress; not consensus" | **keep verbatim** | operator channel is correct; do NOT touch |

**Do-not-touch list (guards against over-replacement):** entries 4 and 11. The raw-byte model is
*correct* for `operator_sig`; only the owner channel changes.

## 7B. CAL Representation Mapping (concrete form — finalized in §8.3)

The owner envelope fields need a home in the CAL; `operator_sig` stays a bare signature. Proposed
(concrete shape is the §8.3 deliverable, listed here for completeness):

| Envelope requirement | Channel | CAL representation (proposed) |
|---|---|---|
| `operator_sig` signature | operator | `signatures.operator_sig` = `bytes` (raw 64-byte Ed25519) — unchanged |
| `owner_sig` signature | owner | `signatures.owner_sig.signature` = `bytes` |
| `domain` | owner | `signatures.owner_sig.domain` |
| `timestamp` | owner | `signatures.owner_sig.timestamp` |
| `address` / `workchain` | owner | `signatures.owner_sig.address` (+ workchain) |

Constraint (envelope §5): all owner reconstruction fields MUST be consensus-visible + identical
across nodes. NOT necessarily in `CAL_HASH` (signature breaks on tamper), but identically
delivered. `operator_sig` adds nothing beyond the existing `bytes`.

## 7C. Validator Wiring Traceability

```
operator channel                       owner channel (when required)
canonical_bytes(cal)                   canonical_bytes(cal) + signatures.owner_sig.{domain,ts,addr,wc}
        ↓                                       ↓
raw ed25519_verify                     Contract A reconstruct → ed25519_verify
        ↓                                       ↓
operatorSigPresent  (owner-sig.ts / owner_sig.go)   ownerSigPresent
        └────────────────────┬────────────────────┘
                             ↓
                        validate()  (pure; §8.1/§8.2; unchanged)
                             ↓
              replay/expiration: nonce + expiration_tick  (unchanged)
```

Two chains, never merged (boundaries fuse + envelope §0/§12).

## 7D. Promotion Checklist (PRE-NORMATIVE → NORMATIVE)

Technical (all green):
- [x] Contract A: 4 captures / 2 wallets · Contract B: 2 captures / 2 wallets
- [x] golden vectors frozen (16) · TS parity · Rust digest parity · Go verdict parity
- [x] cross-channel negatives · validator TS · validator Go
- [x] envelope draft accepted (decisions 1A–5A) · operator/owner routing corrected

Procedural (NEW — must be explicit):
- [ ] **Tier-2 amendment** (changes `signMessage`/`signData.payload` format, §8.3 L336)
- [ ] **1000-tick compatibility window** honored (already-connected wallets)

## Atomic package (execute only after this inventory is reviewed)

1. §8.3 wiring (entries 1–3, 5–7) + name Contracts A/B
2. CAL representation (7B) — owner envelope fields; operator unchanged
3. remove stale D1 assumption (entries 6, 8–10); keep entries 4, 11
4. promote vectors PRE-NORMATIVE → NORMATIVE
5. move drafts (`tc-v2-sig-verify-v1`, `cal-co-signature-envelope`) → `docs/spec/`
6. Gate #1 closure (real Ed25519) · 7. Gate #4 closure (e2e path)

One logical release, as a Tier-2 amendment.
