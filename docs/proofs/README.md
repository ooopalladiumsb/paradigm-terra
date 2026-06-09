# Proof Packages — reproducible operability evidence (Gate #4)

A Proof Package is a self-contained, replayable record that a **signed CAL transited the full
contour** — `signed CAL → transport → wallet → validator → finalized` — proving *operability*,
not just *correctness* (which the golden vectors / parity already establish).

```
PROOF_PACKAGE_1  — first end-to-end happy-path (Gate #4)
```

## Status discipline

| status | meaning |
|---|---|
| `DRY-RUN` | machinery proof — operator + owner signed by locally-generated test keys; proves the assembler reaches `FINALIZED` and emits every field. NOT the live gate. |
| `LIVE` | the `owner_sig` is a real TON Connect v2 wallet signature over the CAL's canonical bytes (one live session); the gate artifact. |

## Schema (every field required; `transport.tx_hash` MAY be `null` if publication is stubbed)

```jsonc
{
  "proof_package": "PROOF_PACKAGE_1",
  "status": "DRY-RUN" | "LIVE",
  "generated_at": "<ISO-8601>",
  "agent_id": "0:<hex>",
  "operator_pubkey": "0x<64hex>",       // raw Ed25519, agent runtime key
  "owner_pubkey": "0x<64hex>",          // raw Ed25519, wallet key (TON Connect)
  "wallet_address": "0:<hex>",          // owner wallet (workchain:address_hash from the envelope)
  "cal": { ... },                       // the full CAL (canonical object)
  "cal_hash": "<hex>",                  // domainHash(CAL_V1, canonical_bytes(cal_without_signatures))
  "cal_id": "<hex>",                    // = cal_hash (key in state.cal.in_flight)
  "signatures": {
    "operator_sig": "0x<128hex>",       // raw Ed25519 over canonical_bytes(cal_without_signatures)
    "owner_sig": { "signature": "0x..", "domain": "..", "timestamp": <u64>, "workchain": <i32>, "address_hash": "0x.." }
  },
  "transport": {
    "tc_session_id": "<uuid|null>",     // TON Connect bridge session (off-chain owner-sig delivery)
    "trace_id": "<uuid|null>",          // wallet signData traceId
    "tx_hash": "<hex|null>"             // sendTransaction BOC root hash if the W5-external leg was run; null if stubbed (§8.3 out-of-scope)
  },
  "ingress_verdict": { "operatorSigPresent": true, "ownerSigPresent": true },  // verifyIngress() output
  "trace": { ... },                     // the ExecutionTrace fed to validate() (booleans DERIVED, not injected)
  "validator_observation": { "events": [ ... ], "terminal_stage": "FINALIZED", "reason_code": null },
  "finalized_observation": { "state_root_before": "<hex>", "state_root_after": "<hex>", "event_log_root": "<hex>" },
  "timestamps": { "owner_sig_unix": <u64>, "tick": <int>, "cal_expiration_tick": <int> }
}
```

## How each field is obtained

- **operator_sig** — programmatic: the agent runtime signs `canonical_bytes(cal_without_signatures)`
  raw with its operator key (no wallet; Exec-spec §8.1/§8.5).
- **owner_sig** — the one LIVE element: a TON Connect v2 `signData`/`binary` session over
  `payload.bytes = base64(canonical_bytes(cal_without_signatures))` of THIS CAL; the wallet returns
  the Contract A commit signature + echoes domain/timestamp/address → the envelope object.
- **ingress_verdict / trace** — `verifyIngress(cal, registry)` derives the booleans (no injection).
- **validator/finalized observation** — the orchestrator node folds `validate()` → reducer; events,
  terminal stage, and STATE_ROOTs come straight from `run()`.

## Assemble

```
# DRY-RUN (machinery proof, generated keys):
node orchestrator/scripts/assemble-proof.mjs            # → docs/proofs/proof-package-1-dryrun.json

# LIVE (real owner_sig capture from one wallet session):
node orchestrator/scripts/assemble-proof.mjs --owner-capture <capture.json>  # → proof-package-1.json
```

## Live owner_sig capture — instruction (the one element only you can produce)

1. Construct the CAL the proof will use (the assembler prints its `canonical_bytes` as base64).
2. In the dApp (`https://ooopalladiumsb.github.io/paradigm-terra/`), invoke `signData`/`binary`
   with `bytes` = **that exact base64** (not an arbitrary sample).
3. Approve in the wallet (testnet). Capture the response: `signature`, `timestamp`, `domain`,
   `address` (+ `wallet.account.publicKey`), and the `traceId` / session id.
4. Write a capture file in the `signatures.owner_sig` envelope shape (+ `owner_pubkey`,
   `wallet_address`, `tc_session_id`, `trace_id`) and run the LIVE assembler.
5. The assembler runs `verifyIngress` → if `ownerSigPresent` is false, the capture doesn't match
   the CAL's canonical bytes (re-check step 2). On `FINALIZED`, `proof-package-1.json` is the gate
   artifact.

## Verify (falsifiable, not narrated)

```
node orchestrator/scripts/verify-proof.mjs                       # TS node
CGO_ENABLED=0 go run ./cmd/verifyproof   # (from orchestrator-go/)  Go node — cross-language proof
```

Both re-derive the package from its OWN contents through the live code: recompute `cal_hash`, re-run
`verifyIngress()` over the stored real signatures (the `owner_sig` is checked against THIS CAL's
canonical bytes — a pass proves the wallet signed exactly this CAL), runs a **negative control**
(one tampered signature byte → `ownerSigPresent: false`, so the test has teeth), and re-folds the
live node (`validate → reduce`) to confirm `FINALIZED` with the stored event sequence, state roots,
and event-log Merkle root. Exit 0 iff every check passes — the gate artifact is a reproducible run,
not a transcribed log.

**Scope boundary (honest).** The trace step results (`ok: true`, effects) are the agent's *claim* —
the validator is trace-only per §4.1 (MCP execution is non-deterministic, out of consensus scope).
So the package proves *authorization + finalization given a well-formed success trace*, not that the
MCP side-effect physically executed. The on-chain publication leg (`sendTransaction` / `tx_hash`) is
`null` by design — out of PFC-1 scope (§8.3). The full ingress→finalized run is now proven through
**two** independent runtimes — the TS node and the Go node (`orchestrator-go/cmd/verifyproof`), which
reproduces the identical `cal_hash`, state roots, and event-log Merkle root from the real signatures.
The Rust node stays deferred-by-constraint (no Ed25519 without a build script); its pure
`validate`/`reduce` are parity-green on the booleans.

Destination for the frozen artifact: `docs/proofs/` (and, when an external audit track exists,
mirrored into `/compliance/` or `/audit/`).
