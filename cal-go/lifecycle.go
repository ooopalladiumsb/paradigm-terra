package cal

// CAL lifecycle constants + transition table (mirrors lifecycle.ts, §3).

var Stages = []string{"CREATED", "SIGNED", "VALIDATED", "EXECUTED", "SETTLED", "FINALIZED", "FAILED", "EXPIRED"}
var TerminalStages = []string{"FINALIZED", "FAILED", "EXPIRED"}

func IsTerminal(stage string) bool {
	for _, s := range TerminalStages {
		if s == stage {
			return true
		}
	}
	return false
}

var EventTypes = []string{"cal.created", "cal.signed", "cal.validated", "cal.executed", "cal.settled", "cal.finalized", "cal.failed", "cal.expired"}

var ReasonCodes = []string{
	"PRECOND_FALSE", "PRECOND_ERROR", "CAPABILITY_DENIED", "NONCE_MISMATCH", "STEP_ERROR",
	"POSTCOND_FALSE", "INVARIANT_FALSE", "OUT_OF_GAS", "UNKNOWN_ACTION", "BOUNDED_BLOCKED",
	"SCHEMA_MISMATCH", "CANCELLED",
}

// TransitionEventType returns the canonical event type for a stage transition,
// or "" if it is not a valid lifecycle transition. from == "*" is external ingress.
func TransitionEventType(from, to string) string {
	nonTerminal := from == "*" || !IsTerminal(from)
	if to == "FAILED" {
		if nonTerminal {
			return "cal.failed"
		}
		return ""
	}
	if to == "EXPIRED" {
		if nonTerminal {
			return "cal.expired"
		}
		return ""
	}
	switch {
	case from == "*" && to == "CREATED":
		return "cal.created"
	case from == "CREATED" && to == "SIGNED":
		return "cal.signed"
	case from == "SIGNED" && to == "VALIDATED":
		return "cal.validated"
	case from == "VALIDATED" && to == "EXECUTED":
		return "cal.executed"
	case from == "EXECUTED" && to == "SETTLED":
		return "cal.settled"
	case from == "SETTLED" && to == "FINALIZED":
		return "cal.finalized"
	}
	return ""
}
