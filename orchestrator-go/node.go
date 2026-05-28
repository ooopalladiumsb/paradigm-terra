// Package orchestrator is the Go parity port of the deterministic node (CAL Exec
// Spec §6/§7 + Canonical Encoding §6.3). It mirrors orchestrator-rs/src/node.rs
// and the TypeScript reference src/node.ts byte-for-byte; see
// ../docs/notes/orchestrator-design.md.
//
// A node folds a program — an ordered list of per-tick blocks, each carrying a
// list of {cal, trace} submissions — through the full pipeline over one evolving
// reducer State:
//
//	for each submission:  cal.created -> cal.signed   (ingress; the reducer enforces
//	                      §6.1 single-in-flight-per-agent and CAL uniqueness)
//	                      validate(cal, snapshot=State, trace) -> lifecycle events
//	                      fold every event through Apply() to advance State
//
// Between blocks it emits tick.advanced. It records the STATE_ROOT after every
// event and the CE §6.3 global stream Merkle root at the end of each tick, and the
// whole event log is byte-for-byte replayable (see Replay). Pure: like the
// validator it consumes execution traces and does not execute steps.
package orchestrator

import (
	"fmt"
	"math/big"

	cal "github.com/paradigm-terra/cal-go"
	calreducer "github.com/paradigm-terra/cal-reducer-go"
	calvalidator "github.com/paradigm-terra/cal-validator-go"
	canonical "github.com/paradigm-terra/canonical-go"
)

// NodeError is a node-level failure (tick regression, a validator-emitted event
// the reducer rejects, or a canonical-encoding error).
type NodeError struct {
	Code   string
	Detail string
}

func (e *NodeError) Error() string { return e.Code + ": " + e.Detail }

func nodeErr(code, detail string) *NodeError { return &NodeError{Code: code, Detail: detail} }
func canonErr(err error) *NodeError {
	return &NodeError{Code: "CANON_ERROR", Detail: fmt.Sprintf("%v", err)}
}

// Submission is one CAL handed to the node with the off-chain executor's trace.
type Submission struct {
	Cal   canonical.Value
	Trace calvalidator.ExecutionTrace
}

// TickBlock is all submissions that land at one tick (must be ≥ the node's tick).
type TickBlock struct {
	Tick        *big.Int
	Submissions []Submission
}

// Program is the start state plus the ordered per-tick blocks to fold.
type Program struct {
	GenesisState canonical.Value
	Ticks        []TickBlock
}

// SubmissionResult records one submission's outcome.
type SubmissionResult struct {
	CalHash string
	AgentID string
	// TerminalStage is nil when rejected at ingress (before validation).
	TerminalStage *string
	// ReasonCode is non-nil only for a FAILED terminal stage.
	ReasonCode *string
	EventTypes []string
	// StateRoots holds the 0x-hex STATE_ROOT after each recorded event.
	StateRoots   []string
	IngressError *string
}

// TickResult is the end-of-tick checkpoint: per-submission results, the STATE_ROOT,
// and the CE §6.3 global stream Merkle root.
type TickResult struct {
	Tick             *big.Int
	Submissions      []SubmissionResult
	StateRoot        string
	GlobalMerkleRoot string
}

// Transcript is the full run output: per-tick checkpoints, the ordered event log
// (fold it from GenesisState to reproduce every root), and the final STATE_ROOT.
type Transcript struct {
	GenesisState   canonical.Value
	Ticks          []TickResult
	EventLog       []canonical.Value
	FinalStateRoot string
}

func hex32(b [32]byte) string { return canonical.ToHexPrefixed(b[:]) }

func eventType(ev canonical.Value) string {
	if o, ok := ev.(*canonical.Object); ok {
		if v, ok := o.Get("event_type"); ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return "?"
}

func currentTickOf(state canonical.Value) *big.Int {
	o, ok := state.(*canonical.Object)
	if !ok {
		return big.NewInt(0)
	}
	tv, ok := o.Get("tick")
	if !ok {
		return big.NewInt(0)
	}
	to, ok := tv.(*canonical.Object)
	if !ok {
		return big.NewInt(0)
	}
	if cv, ok := to.Get("current"); ok {
		if iv, ok := cv.(canonical.Int); ok {
			if n, good := new(big.Int).SetString(string(iv), 10); good {
				return n
			}
		}
	}
	return big.NewInt(0)
}

func strField(obj canonical.Value, key string) (string, *NodeError) {
	if o, ok := obj.(*canonical.Object); ok {
		if v, ok := o.Get(key); ok {
			if s, ok := v.(string); ok {
				return s, nil
			}
		}
	}
	return "", nodeErr("BAD_CAL", key+" must be a string")
}

// globalMerkleRoot is the CE §6.3 global Merkle root over a single "global" stream
// (v0.1.0; the constitution's multi-stream list drops in later).
func globalMerkleRoot(state canonical.Value, log []canonical.Value) (string, *NodeError) {
	var lastEventHash [32]byte
	if len(log) > 0 {
		h, err := cal.EventHash(log[len(log)-1])
		if err != nil {
			return "", canonErr(err)
		}
		lastEventHash = h
	}
	stateHash, err := calreducer.StateRootOf(state)
	if err != nil {
		return "", canonErr(err)
	}
	leaf := canonical.StreamLeaf{
		StreamID:      "global",
		StateHash:     stateHash,
		LastEventHash: lastEventHash,
		LastSeqno:     uint64(len(log)),
	}
	root, err := canonical.StreamTreeRoot([]canonical.StreamLeaf{leaf})
	if err != nil {
		return "", canonErr(err)
	}
	return hex32(root), nil
}

// traceAt re-points a trace at the node's tick (a submission must not misreport the
// tick to dodge expiration); everything else is carried through unchanged.
func traceAt(src calvalidator.ExecutionTrace, tick *big.Int) calvalidator.ExecutionTrace {
	return calvalidator.ExecutionTrace{
		CurrentTick:         new(big.Int).Set(tick),
		Steps:               src.Steps,
		StateBefore:         src.StateBefore,
		StateAfter:          src.StateAfter,
		OperatorSigPresent:  src.OperatorSigPresent,
		OwnerSigPresent:     src.OwnerSigPresent,
		PinnedMCPSchemaHash: src.PinnedMCPSchemaHash,
	}
}

// Run folds a program to a transcript. It errors on a tick regression or on a
// validator-emitted event the reducer rejects (an integration defect).
func Run(program *Program) (*Transcript, *NodeError) {
	genesisState := program.GenesisState
	state := genesisState
	var log []canonical.Value
	var ticks []TickResult
	currentTick := currentTickOf(state)

	for _, block := range program.Ticks {
		if block.Tick.Cmp(currentTick) < 0 {
			return nil, nodeErr("TICK_REGRESSION", fmt.Sprintf("block tick %s < current %s", block.Tick, currentTick))
		}
		if block.Tick.Cmp(currentTick) > 0 {
			adv := canonical.NewObject(
				canonical.P("event_type", "tick.advanced"),
				canonical.P("new_tick", canonical.Int(block.Tick.String())),
			)
			ns, aerr := calreducer.Apply(state, adv)
			if aerr != nil {
				return nil, nodeErr("TICK_REJECTED", aerr.Code)
			}
			state = ns
			log = append(log, adv)
			currentTick = new(big.Int).Set(block.Tick)
		}

		var subs []SubmissionResult
		for _, sub := range block.Submissions {
			ch, err := cal.CalHash(sub.Cal)
			if err != nil {
				return nil, canonErr(err)
			}
			calHashHex := canonical.ToHexPrefixed(ch[:])
			agentID, ferr := strField(sub.Cal, "agent_id")
			if ferr != nil {
				return nil, ferr
			}
			var eventTypes []string
			var stateRoots []string

			// Ingress: cal.created then cal.signed (reducer enforces §6.1 / uniqueness).
			var ingressError *string
			ingress := []canonical.Value{
				canonical.NewObject(canonical.P("event_type", "cal.created"), canonical.P("cal_hash", calHashHex), canonical.P("agent_id", agentID)),
				canonical.NewObject(canonical.P("event_type", "cal.signed"), canonical.P("cal_hash", calHashHex)),
			}
			for _, ev := range ingress {
				ns, aerr := calreducer.Apply(state, ev)
				if aerr != nil {
					code := aerr.Code
					ingressError = &code
					break
				}
				state = ns
				log = append(log, ev)
				eventTypes = append(eventTypes, eventType(ev))
				sr, serr := calreducer.StateRootOf(state)
				if serr != nil {
					return nil, canonErr(serr)
				}
				stateRoots = append(stateRoots, hex32(sr))
			}
			if ingressError != nil {
				subs = append(subs, SubmissionResult{CalHash: calHashHex, AgentID: agentID, EventTypes: eventTypes, StateRoots: stateRoots, IngressError: ingressError})
				continue
			}

			// Validate against the live state (tick pinned), then fold the events.
			trace := traceAt(sub.Trace, currentTick)
			res, verr := calvalidator.Validate(sub.Cal, calHashHex, state, trace)
			if verr != nil {
				return nil, nodeErr("VALIDATE_ERROR", verr.Error())
			}
			for _, ev := range res.Events {
				ns, aerr := calreducer.Apply(state, ev)
				if aerr != nil {
					return nil, nodeErr("APPLY_FAILED", fmt.Sprintf("%s event %s rejected: %s", res.TerminalStage, eventType(ev), aerr.Code))
				}
				state = ns
				log = append(log, ev)
				eventTypes = append(eventTypes, eventType(ev))
				sr, serr := calreducer.StateRootOf(state)
				if serr != nil {
					return nil, canonErr(serr)
				}
				stateRoots = append(stateRoots, hex32(sr))
			}

			stage := res.TerminalStage
			var reason *string
			if res.ReasonCode != "" {
				rc := res.ReasonCode
				reason = &rc
			}
			subs = append(subs, SubmissionResult{
				CalHash:       calHashHex,
				AgentID:       agentID,
				TerminalStage: &stage,
				ReasonCode:    reason,
				EventTypes:    eventTypes,
				StateRoots:    stateRoots,
			})
		}

		stateRoot, serr := calreducer.StateRootOf(state)
		if serr != nil {
			return nil, canonErr(serr)
		}
		gmr, gerr := globalMerkleRoot(state, log)
		if gerr != nil {
			return nil, gerr
		}
		ticks = append(ticks, TickResult{
			Tick:             new(big.Int).Set(currentTick),
			Submissions:      subs,
			StateRoot:        hex32(stateRoot),
			GlobalMerkleRoot: gmr,
		})
	}

	fsr, ferr := calreducer.StateRootOf(state)
	if ferr != nil {
		return nil, canonErr(ferr)
	}
	return &Transcript{GenesisState: genesisState, Ticks: ticks, EventLog: log, FinalStateRoot: hex32(fsr)}, nil
}

// Replay re-folds an event log from a start state and returns the final STATE_ROOT (§7.2).
func Replay(eventLog []canonical.Value, genesisState canonical.Value) (string, *NodeError) {
	state := genesisState
	for _, ev := range eventLog {
		ns, aerr := calreducer.Apply(state, ev)
		if aerr != nil {
			return "", nodeErr("REPLAY_FAILED", aerr.Code)
		}
		state = ns
	}
	sr, err := calreducer.StateRootOf(state)
	if err != nil {
		return "", canonErr(err)
	}
	return hex32(sr), nil
}
