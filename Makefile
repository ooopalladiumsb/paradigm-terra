# Paradigm Terra — PFC-1 reproducibility command set.
# Thin front-end over scripts/repro.sh (the single source of truth, which also runs without `make`).
# A reviewer should reproduce the freeze-candidate status WITHOUT knowing project history.
# See docs/spec/freeze-manifest-pfc1.md for what these targets are evidence FOR.
#
#   make setup            # clean-room bootstrap: install + build TS packages in dependency order
#   make freeze-check     # fast gate: vectors NORMATIVE + both proof verifiers pass
#   make verify-proof     # Gate #4 — re-derive Proof Package #1 via the TS and Go nodes
#   make parity           # full cross-language parity: TS == Rust == Go (all layers)
#   make vectors-check    # assert every golden vector + tc-v2 manifest is NORMATIVE
#   make bench            # Gate #2 — ns/op baseline harnesses (advisory, §C.4)
#
# See docs/notes/reproducibility-guide.md for the clean-room walkthrough + the deterministic-root
# vs property-target split. OVT targets (ovt1/ovt2/ovt-sg/ovt3-soak/ovt3-griefing) run via repro.sh.

.PHONY: setup typecheck freeze-check verify-proof verify-proof-ts verify-proof-go parity parity-ts parity-rs parity-go vectors-check bench m2-registry help

help setup typecheck freeze-check verify-proof verify-proof-ts verify-proof-go parity parity-ts parity-rs parity-go vectors-check bench m2-registry:
	@scripts/repro.sh $@
