# TMA — Telegram Mini App charter

**Date:** 2026-06-12 · Branch `product/tma` (proposed) · Opens a **product surface** track, strictly
**off-consensus**. Like Track A this charter fixes the discipline and the Definition of Done before the
artifacts — but unlike every prior track it produces **no consensus, no operational kernel, and no
normative artifact**. It builds a human-facing client on top of the already-proven TON Connect v2 owner
ingress.

This track exists because a repo-wide audit (2026-06-12) found **zero** prior accounting for Telegram
Mini Apps anywhere in the vision (`SIMULATION_PREVIEW.md`), the specs, the code, or any roadmap. The only
incidental Telegram touchpoints are Cocoon's GitHub org, two community channels (`LINKS.md`), and the
*Wallet* wallet flagged "not yet tested" in `interoperability-matrix.md`. TMA was never a designed surface
— the vision's two interfaces are the agent-facing console (LLM) and the `agents.ton.org` dashboard
(web). This charter retrofits a Telegram delivery surface onto the existing TON Connect primitive.

## The transition this track marks

```
"Can this consensus model work?"          → ANSWERED (OVT + PP#2 + H3.5)
"Can we operate it for years?"            → ANSWERED (PR-1)
"Can we declare a version released?"      → ANSWERED (Track A → v1.0.0/v1.1.0)
        ↓
"Can a human drive an owner-signed CAL    → TMA (this track)
 from inside Telegram, with no new
 trust in the consensus core?"
```

Every prior track answered a question about the *system*. TMA answers a question about *reach*: it adds a
client surface and changes nothing a validator can observe. The bytes that reach `verifyIngress()` are
identical whether they came from a desktop browser, a mobile wallet deeplink, or a Mini App.

## The thing that matters: owner ingress is unchanged

The single discriminator this track is built around:

```
A CAL owner-signed through the Mini App is byte-for-byte the same owner-envelope a
validator already accepts (§8.3 TC_V2_SIGNDATA_VERIFY_V1). The Mini App is a transport
of the existing signature, never a new authorization path.
```

If the TMA ever needs a spec change, a new RPC, or a different `signData.payload` shape, it has left this
charter's scope and become a §8.4 Tier-2 amendment — which this track explicitly does **not** do. The
Mini App reuses the exact owner channel proven live in PP#1 (Tonkeeper `signData`/`binary` →
`ownerSigPresent: true` → `validate()` → `cal.finalized`).

## Discipline (anti-scope)

- **Strictly off-consensus.** Touches no canonical / dsl / cal / validator / reducer / gas normative
  code, no operational kernel (PR-1), no golden vectors. The `freeze-gate` is byte-identical throughout,
  by construction — this track ships nothing the gate covers. A Freeze-Surface defect surfaced here still
  re-opens the freeze (criterion 7 is permanent), but that is not this track's purpose.
- **Not on the critical path.** Per the dependency map, TMA is a variant of the `D1: Dashboard` node in
  the Слой-4 product track. It must not gate mainnet, the contract suite, or governance. It can ship and
  iterate entirely after launch.
- **No new authorization path.** The owner channel is TON Connect v2 `signData` (Contract A commit) and
  nothing else. The Mini App does not introduce a server-side signer, a custodial key, or a bypass of
  `OWNER_REQUIRED_ACTIONS`. `initData` (Bot-API HMAC) authenticates the *Telegram user to the bot*; it is
  **never** treated as owner authorization of a CAL.
- **Versioning.** Product surface → its own `tma-vX.Y.Z` line or an ordinary off-consensus MINOR on the
  1.x line (`release-governance.md`); it does **not** consume a PFC freeze line and cannot trigger a MAJOR
  bump on its own.

## Scope

### In
- A Telegram Mini App that opens a TON Connect v2 session inside Telegram, signs an owner CAL via
  `signData`/`binary` over `canonical_bytes(cal_without_signatures)`, and surfaces the resulting
  lifecycle (`created → signed → validated → … → finalized`) and STATE_ROOT to the user.
- `initData` validation (Bot-API HMAC-SHA256 over the sorted data-check-string with the bot token) — to
  authenticate the Telegram user to the bot backend, for session/notification only.
- A minimal bot backend: deeplink handling, session bootstrap, and read-only push notifications of node
  state (rides the existing observer/monitoring outputs, never a privileged writer).
- A TON-Connect `manifest.json` served from a stable public HTTPS origin (mobile wallets reject
  `localhost`; see `interop/dapp/README.md`).

### Out (Non-goals)
- Any change to the owner-sig contract, the §8.3 RPC set, or `signData.payload` shape (that is §8.4
  Tier-2, a different track).
- Custodial signing, server-held keys, or any owner-authorization that does not originate in the user's
  TON Connect wallet.
- New CAL verbs, new publication codecs, or on-chain contracts (those are the Слой-1/2/3 tracks).
- Multilingual / RTL presentation (`SIMULATION_PREVIEW` ✨ item) — independent, can layer on later.
- Confidential compute (Cocoon) integration — independent periphery.

## What this reuses (already built)

| Primitive | Where | Status |
|---|---|---|
| Owner ingress `verifyIngress()` (§8.3) | `orchestrator/src/ingress.ts`, `orchestrator-go/ingress.go` | ✅ proven live (PP#1) |
| TON Connect v2 dApp (single-file, no build) | `interop/dapp/index.html` — `@tonconnect/ui@2.4.4`, `@tonconnect/sdk@3.4.1`, `signData`/`ton_proof` | ✅ deployed (gh-pages) |
| Stable HTTPS manifest + export discipline | `interop/dapp/manifest.json`, `gh-pages` orphan branch | ✅ exists |
| Canonical bytes / CAL hashing | `@paradigm-terra/canonical`, `@paradigm-terra/cal` | ✅ frozen |

The interop dApp is the natural starting point: it already does the TON Connect v2 + `signData` half. TMA
wraps it in the Telegram WebApp SDK, swaps the observational logger for a CAL builder + lifecycle view,
and adds the bot backend for `initData` and notifications.

## Definition of Done

```
DoD-1  A human, inside Telegram, connects a TON Connect v2 wallet via the Mini App and owner-signs a
       CAL whose owner-envelope verifyIngress() accepts (ownerSigPresent: true) — proven against a real
       wallet, mirroring PP#1's evidentiary bar.
DoD-2  The signed bytes are byte-identical to a CAL owner-signed through the existing interop dApp
       (transport-equivalence: TMA adds no envelope drift).
DoD-3  initData HMAC validation rejects a tampered data-check-string and accepts a genuine one
       (test vector + live bot check); initData is never accepted as CAL owner authorization.
DoD-4  freeze-gate green and byte-identical on the branch HEAD (off-consensus proof).
DoD-5  A stranger can reproduce DoD-1/2 from the repo: manifest, source, and the run procedure are
       committed (interop-style export discipline).
```

## Milestones

| # | Item | Effort | Depends on |
|---|---|---|---|
| **T0** | Charter + branch `product/tma`; lift `interop/dapp` into a TMA skeleton (Telegram WebApp SDK + `@tonconnect/ui` TMA mode) | S | interop dApp ✅ |
| **T1** | Owner-CAL builder + lifecycle view (canonical bytes → `signData` → ingress → STATE_ROOT) | S | `verifyIngress()` ✅ |
| **T2** | Bot backend: deeplink, session, `initData` HMAC validation (+ vector for DoD-3) | M | — |
| **T3** | Public HTTPS manifest + TMA-viewport UI/theming; read-only push notifications | M | observer/monitoring ✅ |
| **T4** | Transport-equivalence proof (DoD-2) + live wallet run (DoD-1) + repro doc (DoD-5) | S | T1, T2 |

**Total ≈ M (3–5 weeks).** The one genuinely new dependency is the **Telegram bot backend** for
`initData` (HMAC over the bot token) — outside the TON Connect model, and the only piece not already in
the repo.

## Related
- `ton-connect-ingress-design.md` — the §8.3 owner channel this rides.
- `interop/dapp/README.md` — the TON Connect v2 dApp this lifts from.
- `track-a-charter.md` — the off-Freeze-Surface discipline this mirrors.
- `interoperability-matrix.md` — the *Wallet* (Telegram) row, "not yet tested", a natural TMA test target.
- `SIMULATION_PREVIEW.md` — the original vision (agent console + `agents.ton.org` dashboard) that TMA
  extends with a Telegram surface never previously scoped.
