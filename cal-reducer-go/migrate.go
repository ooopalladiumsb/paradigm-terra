package calreducer

// PFC2-M3 — multisig (AuthorizationSet v2) registry: the v1→v2 migration and the well-formed
// owner-record invariant. Mirrors migrate.ts / migrate.rs (§1.1/§4). The bound is enforced where
// Deltas commit an owner record (see delta.go); this file is the single source of the invariant and
// the deterministic upgrade (state-only, no external input ⇒ reproducible for the M5 vectors).

import (
	"sort"
	"strconv"

	canonical "github.com/paradigm-terra/canonical-go"
)

// MaxOwners is the §1.1 upper bound on the owner set.
const MaxOwners = 16

// OwnerRecordWellFormed is the §1.1 invariant: owners non-empty, DISTINCT, ascending (by raw pubkey
// bytes; equal-length hex, so string order == byte order), at most MaxOwners; and
// 1 <= threshold <= len(owners). Mirrors ownerRecordWellFormed.
func OwnerRecordWellFormed(owners, threshold canonical.Value) bool {
	arr, ok := owners.([]canonical.Value)
	if !ok {
		return false
	}
	tInt, ok := threshold.(canonical.Int)
	if !ok {
		return false
	}
	t, err := strconv.ParseUint(string(tInt), 10, 64)
	if err != nil {
		return false
	}
	n := len(arr)
	if n < 1 || n > MaxOwners {
		return false
	}
	if t < 1 || t > uint64(n) {
		return false
	}
	for i := range n {
		o, ok := arr[i].(string)
		if !ok || o == "" {
			return false
		}
		if i > 0 {
			prev, _ := arr[i-1].(string)
			if o == prev || o < prev { // distinct + ascending
				return false
			}
		}
	}
	return true
}

// MigrateRegistryV1ToV2 is the §4 deterministic v1→v2 registry upgrade — a pure function of the
// state alone (no external input), idempotent. owner_pubkey:"K" → owners:["K"], threshold:1 (1-of-1
// bridge, SC-4); owner_pubkey:"" → owners:[], threshold:0 (no-owner). Mirrors migrateRegistryV1ToV2.
func MigrateRegistryV1ToV2(state canonical.Value) canonical.Value {
	agentsV, ok := getIn(state, []string{"registry", "agents"})
	if !ok {
		return state
	}
	agents, ok := agentsV.(*canonical.Object)
	if !ok {
		return state
	}
	ids := append([]string(nil), agents.Keys()...)
	sort.Strings(ids)
	s := state
	for _, id := range ids {
		recV, ok := getIn(s, []string{"registry", "agents", id})
		if !ok {
			continue
		}
		rec, ok := recV.(*canonical.Object)
		if !ok {
			continue
		}
		if _, hasOwners := rec.Get("owners"); hasOwners {
			continue // already v2
		}
		pkV, hasPk := rec.Get("owner_pubkey")
		if !hasPk {
			continue // nothing to migrate
		}
		pk, _ := pkV.(string)
		owners := []canonical.Value{}
		threshold := "0"
		if pk != "" {
			owners = []canonical.Value{pk}
			threshold = "1"
		}
		s = setIn(s, []string{"registry", "agents", id, "owners"}, owners)
		s = setIn(s, []string{"registry", "agents", id, "threshold"}, canonical.Int(threshold))
		s = deleteIn(s, []string{"registry", "agents", id, "owner_pubkey"})
	}
	return s
}

// enforceOwnerRecord is the PFC2-M3 §1.1 bound, enforced where a Delta commits
// registry/agents/<a>/owners or .../threshold. Fires only once BOTH fields are present (a
// partially-built record is a transient intermediate). Mirrors enforceOwnerRecord in delta.ts.
func enforceOwnerRecord(state canonical.Value, full []string) *ApplyError {
	if len(full) != 4 || full[0] != "registry" || full[1] != "agents" {
		return nil
	}
	if full[3] != "owners" && full[3] != "threshold" {
		return nil
	}
	recV, ok := getIn(state, []string{"registry", "agents", full[2]})
	if !ok {
		return nil
	}
	rec, ok := recV.(*canonical.Object)
	if !ok {
		return nil
	}
	ownersV, hasOwners := rec.Get("owners")
	thV, hasTh := rec.Get("threshold")
	if !hasOwners || !hasTh {
		return nil // not yet complete
	}
	if !OwnerRecordWellFormed(ownersV, thV) {
		return aerr("BAD_OWNER_RECORD")
	}
	return nil
}
