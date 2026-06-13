# Genesis-B Gate — pre-deploy checkpoint (live Layer-2 genesis)

**Date:** 2026-06-13 · **Status:** gate / pre-registration. The checkpoint that must hold BEFORE the
irreversible ton-testnet deployment of the Layer-2 observational suite. **Tier-M, no Freeze Surface**
(Framing A read-models, v2.2.0). Follows the PP#3-B/PP#4-B/PP#5-B discipline. **Nothing here touches the
network** — the live steps are §3, gated on §2.

## 0. What Genesis-B confirms

L2.6 (`layer2-toolchain-charter.md`) proved OFFLINE that the full suite deploys from genesis in
`@ton/sandbox` to an all-empty state. Genesis-B does the same on **ton-testnet**: deploy the five
read-model contracts from their pinned genesis (code + genesis data), each owned by the publisher, each
starting empty. It **creates no consensus** — it stands up the on-chain projections (Framing A).

```
deploy:  registry · treasury · failure-state · capability · anchor-index
expect:  each active · owner == publisher · all projected state empty/zero (nothing mirrored yet)
```

## 1. Reproducibility evidence (pinned, from L2.6)

```
toolchain         @ton/tolk-js 1.4.1 (pinned, WASM); Acton deferred-by-constraint
code hashes       registry 1ED1C543… · treasury 40DF89F7… · failure-state 4B51086D… ·
                  capability E6407A9E… · anchor-index F51ED423…   (tolk/build/*.compiled.json, drift-guarded)
genesis builder   tolk/src/genesis.ts — genesisManifest(owner) / genesisDeploy(name, owner)
reference manifest tolk/artifacts/genesis/genesis-manifest.json (REFERENCE_OWNER 0:11..11; 5 distinct addrs)
offline proof     tolk/test/genesis.test.ts — full suite deploys to all-empty state; addresses deterministic
```

## 2. Operational prerequisites — REQUIRED before §3 (operator-supplied; NOT done here)

```
[ ] funded ton-testnet publisher wallet (the suite owner + deployer)
      · address: ____________________   · balance ≥ ~0.5 TON (5 deploys × ~0.05–0.1 + fees)
[ ] key custody confirmed (Path 2 TON Connect, or a custodied signer)
[ ] re-derived, pinned for the real publisher (offline, deterministic):
      · genesisManifest(realPublisher) → the five LIVE addresses + code hashes (record as genesis-b-plan)
[ ] re-confirmation: tolk suite green (28/0); manifest re-derivation drift-guard still holds
```

## 3. Genesis-B runbook (the live steps — GATED on §2)

```
Step  Action                                                       Irreversible?
1     read-only: confirm publisher wallet active + funded          no
2     re-derive genesisManifest(realPublisher) → 5 addresses       no (offline, deterministic)
3     for each contract: deploy from genesisDeploy(name, owner)    YES — tx each (idempotent per address)
      (stateInit { code, data } to its deterministic address)
4     read-only per contract: assert active · owner == publisher · no
      initial getter empty (agentCount/mode/nav/... == 0)
5     record evidence → tolk/artifacts/genesis/genesis-b-evidence.json   no (idempotent write)
```

The five deploys are independent and order-free (no inter-contract messages at genesis — each is a bare
stateInit). Wiring the contracts to a real off-chain publisher feed is a SEPARATE later step, not Genesis-B.

## 4. Roll-forward / resume plan (idempotency)

| Step | Irreversible? | Resume rule |
|---|---|---|
| 3 deploy each | YES | deterministic address — if a contract is already active at its address, skip it |
| 4 verify | no | re-runnable (read-only); the OBSERVED on-chain state decides |
| 5 evidence | no | idempotent upsert keyed by contract address |

A partial run (some contracts deployed) resumes by deploying only the addresses not yet active.

## 5. Evidence package structure (`tolk/artifacts/genesis/genesis-b-evidence.json`)

```json
{
  "result": "GENESIS-B SETTLED",
  "network": "ton-testnet",
  "publisher": "<owner/deployer>",
  "contracts": [
    { "name": "registry", "address": "<addr>", "code_hash": "1ed1c543…", "deploy_tx": "<hash>", "active": true, "owner_ok": true, "empty_ok": true }
  ],
  "manifest_matches_pinned": "genesisManifest(publisher) == the live addresses",
  "verdict": "SETTLED"
}
```

## 6. Success criteria — Genesis-B PASSES iff

```
SC-1  all five contracts deploy and are active on ton-testnet at their genesisManifest(publisher) addresses
SC-2  each contract's owner getter == the publisher
SC-3  each contract's initial state is empty/zero (no projection written at genesis)
SC-4  the offline manifest re-derivation still matches (determinism intact)
SC-5  no Freeze Surface defect (Framing A — read-models; the off-chain consensus is untouched)
```

On all five, Genesis-B is SETTLED → the Layer-2 observational suite is live; the v2.x operational backlog
(PP#5-B + Genesis-B) is closed, clearing the way for the Layer-3 charter.

## 7. Related
- `layer2-toolchain-charter.md` — the Framing A suite + L2.6 genesis this deploys.
- `pp4-b-gate.md` / `pp5-b-gate.md` — the broadcast/deploy gate discipline this mirrors.
- `tolk/src/genesis.ts` · `tolk/artifacts/genesis/genesis-manifest.json` — the pinned deploy surface.
