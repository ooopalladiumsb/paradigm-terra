# Paradigm Terra — PFC-1 reproducibility command set.
# Thin front-end over scripts/repro.sh (the single source of truth, which also runs without `make`).
# A reviewer should reproduce the freeze-candidate status WITHOUT knowing project history.
# See docs/spec/freeze-manifest-pfc1.md for what these targets are evidence FOR.
#
#   make freeze-check     # fast gate: vectors NORMATIVE + both proof verifiers pass
#   make verify-proof     # Gate #4 — re-derive Proof Package #1 via the TS and Go nodes
#   make parity           # full cross-language parity: TS == Rust == Go (all layers)
#   make vectors-check    # assert every golden vector + tc-v2 manifest is NORMATIVE
#   make bench            # Gate #2 — ns/op baseline harnesses (advisory, §C.4)

.PHONY: freeze-check verify-proof verify-proof-ts verify-proof-go parity parity-ts parity-rs parity-go vectors-check bench help

help freeze-check verify-proof verify-proof-ts verify-proof-go parity parity-ts parity-rs parity-go vectors-check bench:
	@scripts/repro.sh $@
