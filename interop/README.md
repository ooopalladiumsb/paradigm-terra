# interop/ — post-PFC-1 observational track

Phase-1 instrumentation for the `post-pfc1/interop-smoke` branch. Anchors
`7n5ywp` (minimal observational dApp) and `z3h0ix` (PFC-1 defines, this
observes).

## Layout

```
interop/
  dapp/                  Single-file vanilla HTML observational dApp
    index.html
    manifest.json        TonConnect manifest (localhost default)
    README.md            How to run, observation schema, scope discipline
  observations/          Per-wallet, per-session JSON logs exported from dApp
    .gitkeep             (real observations land alongside this)
```

The matrix at `docs/notes/interoperability-matrix.md` is the artifact this
work targets. Everything here is scaffolding around populating that matrix.

## Discipline

Read `dapp/README.md` § "What it doesn't do" before adding any code. The dApp
must stay observational; any logic that drifts toward orchestration or
validation belongs on a different branch.

## Status

- 2026-05-29 — dApp + matrix scaffold landed on `post-pfc1/interop-smoke`. No
  real wallet sessions captured yet.
