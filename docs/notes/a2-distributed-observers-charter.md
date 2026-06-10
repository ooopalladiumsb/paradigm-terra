# A2 Charter — Distributed observers (an observer fleet)

**Date:** 2026-06-10 · **Status:** charter / pre-registration (no code). Post-release v1.x maintenance
line, **Tier M** (above the Freeze Surface). The last v1.x operational item; follows M1–M3 + A1. Ratify
before the first A2 PR.

## 0. Architect ruling

Ruled 2026-06-10. A2 scales PR-1.8's **single** live observer (`live-observer.ts`, which closes
H3.5-live) into a **fleet** of independent tailers that reach **consensus on the published root**.

```
Role:           strengthen H3.5-live from one observer to a quorum of independent re-derivations
Mode:           observe-only (the PR-1.8 discipline) — the fleet reads, the node owns the truth
Tier:           M (maintenance)  ·  Freeze Surface: immutable
```

## 1. The one rule

A2 **observes and reports; it decides nothing** (PR-1.8: "monitoring observes, consensus decides" — and
here even the fleet only *re-checks* the node's own published checkpoint). No verb, no
`cal/validator/reducer/canonicalization/economics` change, no writes to the node directory. `freeze-gate`
stays byte-identical (SC-Freeze).

## 2. Why a fleet (the value over one observer)

A single observer that itself is buggy/compromised could mis-verify the node. A fleet of **independent**
re-derivations distinguishes the two failure modes one observer cannot:

- all N independently derive root `R`, node-claimed `== R` ⇒ **CONSENSUS_OK** (node corroborated by a quorum)
- all N derive `R`, node-claimed `≠ R` ⇒ **NODE_DRIFT** (the fleet *unanimously* contradicts the node — the H3.5 win)
- the observers **split** (a dissenter from the quorum) ⇒ **OBSERVER_SPLIT** (a faulty/compromised tailer,
  isolated *without* false-flagging the node — the quorum still corroborates it)

## 3. Scope

### IN (A2, Tier M)
- `ObserverFleet` — runs N **injectable** independent members (default: N `LiveObserver` re-folds; a real
  deployment plugs genuinely independent implementations/hosts, e.g. the Go re-fold) and aggregates their
  verdicts under a **quorum** rule into a `FleetVerdict` (CONSENSUS_OK / NODE_DRIFT / OBSERVER_SPLIT / EMPTY).
- Dissenter isolation: the fleet names which member(s) diverge from the quorum.
- An accelerated in-repo proof + a note on wiring real cross-host/cross-language members (the latter gated,
  like the single observer's Go script).

### OUT
- Any `cal/validator/reducer/canonicalization/economics` change (Freeze Surface).
- The fleet acting on a verdict (it reports; remediation is separate) or writing to the node.
- A real multi-host deployment as a required dependency (members are injectable; in-repo proof closes A2).

## 4. Success criteria (pinned)

```
SC-1  CONSENSUS_OK  — a fleet of N independent tailers reaches quorum on the published root AND corroborates
                      the node's claim.
SC-2  NODE_DRIFT    — when the node's claimed root is tampered, the fleet quorum UNANIMOUSLY contradicts it
                      (the H3.5 strengthening: > 1 independent witness).
SC-3  OBSERVER_SPLIT — an injected faulty member (wrong root) is detected and ISOLATED (named dissenter),
                      the node still corroborated by the remaining quorum (observer-fault ≠ node-fault).
SC-4  observe-only  — the fleet reads the node dir and writes nothing (byte-identical dir before/after).
SC-Freeze           — no Freeze Surface movement; freeze-gate byte-identical.
```

## 5. Failure taxonomy

A fleet verdict is a **signal**, never a consensus action:
- **NODE_DRIFT** — the node's published claim is wrong (quorum contradicts it): a real, high-severity
  signal → opens a separate investigation of the node (this is the gate's whole point).
- **OBSERVER_SPLIT** — a tailer is faulty/compromised (dissents from the quorum): fix/replace that
  observer; the node is fine. Discriminator: does the dissenter reproduce against the proven
  `LiveObserver` on the same dir? If the proven re-fold agrees with the quorum, the dissenter is the fault.
- **Fleet-aggregator defect** — a bug in A2's own quorum logic: a false verdict; fixed in A2.
Neither can move the Freeze Surface — A2 only observes.

## 6. Branch policy
Working branch: **`post-release/a2-distributed-observers`** (off `main`, like M1–M3/A1). The fleet +
accelerated proof land as ordinary operational PRs; a real multi-host fleet is operated on infra and is
not a CI gate.

## 7. Related
- `pr1.8-live-observer.md` / `src/node/live-observer.ts` — the single observer A2 scales (the member default).
- `scripts/pr1-8-live-observer.mjs` — the independent Go re-fold (a real cross-language fleet member).
- `pr1.9-soak.md` / `a1-soak-charter.md` — the soak that consumes the observer verdict (a fleet verdict can feed SC-5 there).
- `roadmap-v1.x.md` — "Distributed observers", the last Tier-M operational item; after it, the line is fully hardened (next growth is PFC-2 → v2.0.0).
