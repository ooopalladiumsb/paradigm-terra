# interop observation harness

A single-page TON Connect v2 observation harness, served over HTTPS via
GitHub Pages at <https://ooopalladiumsb.github.io/paradigm-terra/>.

**This is not** a validator, an orchestrator, a protocol implementation, or a
reference client. The protocol specification defines protocol behavior; this
page only **records wallet behavior** (connect, `ton_proof`, `signData` /
`signMessage`, `sendTransaction`) and lets you export the session as JSON.

## Provenance

This branch is a **one-directional sanitized export**. It is regenerated from
an upstream observational source; it is never edited directly. It deliberately
contains **only** the harness:

- `index.html` — the harness
- `manifest.json` — TON Connect manifest (origin-bound to the Pages URL)
- `README.md` — this file

No observation logs, no result matrices, no protocol notes live on this branch.
The GitHub Pages domain here is an **observation origin**, not a protocol origin.
