// Differential-fuzz harness for the Go parity validator.
//
// Shares the line protocol documented in validator/fuzz/ts_harness.mjs:
//   stdin  : one case per line — hex of canonical-JSON { cal, cal_hash, snapshot, trace }.
//   stdout : "OK <types>|<stage>|<reason>|<vfee>|<tfee>|<gc>|<gr>|<fr,dg,gr,tac>"
//            / "ERR BADCASE" / "ERR COMPUTE", in order.
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"strings"

	calvalidator "github.com/paradigm-terra/cal-validator-go"
	canonical "github.com/paradigm-terra/canonical-go"
)

func bigOf(v canonical.Value) *big.Int {
	if iv, ok := v.(canonical.Int); ok {
		if n, good := new(big.Int).SetString(string(iv), 10); good {
			return n
		}
	}
	return big.NewInt(0)
}

func buildTrace(j canonical.Value) calvalidator.ExecutionTrace {
	o, _ := j.(*canonical.Object)
	get := func(k string) canonical.Value {
		if o == nil {
			return nil
		}
		v, _ := o.Get(k)
		return v
	}
	var steps []calvalidator.StepResult
	if sv := get("steps"); sv != nil {
		if arr, ok := sv.([]canonical.Value); ok {
			for _, s := range arr {
				so, _ := s.(*canonical.Object)
				st := calvalidator.StepResult{}
				if so != nil {
					if okv, _ := so.Get("ok"); okv == true {
						st.OK = true
					}
					if ev, ok := so.Get("effects"); ok {
						if ea, ok := ev.([]canonical.Value); ok {
							st.Effects = ea
						}
					}
					if ed, ok := so.Get("error_detail"); ok {
						if eds, ok := ed.(string); ok {
							st.ErrorDetail = eds
						}
					}
				}
				steps = append(steps, st)
			}
		}
	}
	ownerSig := false
	if get("owner_sig_present") == true {
		ownerSig = true
	}
	pinned := ""
	if p, ok := get("pinned_mcp_schema_hash").(string); ok {
		pinned = p
	}
	return calvalidator.ExecutionTrace{
		CurrentTick:         bigOf(get("current_tick")),
		Steps:               steps,
		StateBefore:         get("state_before"),
		StateAfter:          get("state_after"),
		OwnerSigPresent:     ownerSig,
		PinnedMCPSchemaHash: pinned,
	}
}

// evInt returns the decimal-string value of key in the first event of type etype, or "-".
func evInt(events []canonical.Value, etype, key string) string {
	for _, e := range events {
		o, ok := e.(*canonical.Object)
		if !ok {
			continue
		}
		if et, _ := o.Get("event_type"); et == etype {
			if v, ok := o.Get(key); ok {
				if iv, ok := v.(canonical.Int); ok {
					return string(iv)
				}
			}
			return "-"
		}
	}
	return "-"
}

func termInt(events []canonical.Value, key string) string {
	if len(events) == 0 {
		return "-"
	}
	o, ok := events[len(events)-1].(*canonical.Object)
	if !ok {
		return "-"
	}
	if v, ok := o.Get(key); ok {
		if iv, ok := v.(canonical.Int); ok {
			return string(iv)
		}
	}
	return "-"
}

func handle(line string) string {
	raw, err := hex.DecodeString(line)
	if err != nil {
		return "ERR BADCASE"
	}
	doc, err := canonical.ParseCanonical(string(raw))
	if err != nil {
		return "ERR BADCASE"
	}
	o, ok := doc.(*canonical.Object)
	if !ok {
		return "ERR BADCASE"
	}
	cal, ok1 := o.Get("cal")
	snapshot, ok2 := o.Get("snapshot")
	chV, ok3 := o.Get("cal_hash")
	traceV, ok4 := o.Get("trace")
	if !ok1 || !ok2 || !ok3 || !ok4 {
		return "ERR BADCASE"
	}
	calHash, ok := chV.(string)
	if !ok {
		return "ERR BADCASE"
	}
	res, verr := calvalidator.Validate(cal, calHash, snapshot, buildTrace(traceV))
	if verr != nil {
		return "ERR COMPUTE"
	}
	types := make([]string, 0, len(res.Events))
	for _, e := range res.Events {
		if eo, ok := e.(*canonical.Object); ok {
			if et, _ := eo.Get("event_type"); et != nil {
				if s, ok := et.(string); ok {
					types = append(types, s)
					continue
				}
			}
		}
		types = append(types, "?")
	}
	reason := res.ReasonCode
	if reason == "" {
		reason = "-"
	}
	b := res.Bill
	return fmt.Sprintf("OK %s|%s|%s|%s|%s|%s|%s|%s,%s,%s,%s",
		strings.Join(types, ","),
		res.TerminalStage,
		reason,
		evInt(res.Events, "cal.validated", "escrow_ptra"),
		termInt(res.Events, "fee_debited_ptra"),
		termInt(res.Events, "gas_consumed_ptra"),
		termInt(res.Events, "gas_refunded_ptra"),
		b.FeeRetained.String(), b.DynamicGasConsumed.String(), b.GasRefunded.String(), b.TotalAgentCharge.String(),
	)
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		fmt.Fprintln(w, handle(line))
	}
}
