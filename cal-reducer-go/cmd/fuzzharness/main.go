// Differential-fuzz harness for the Go parity reducer.
//
// Shares the line protocol documented in cal-reducer/fuzz/ts_harness.mjs:
//   stdin  : one case per line — hex of canonical-JSON { "start", "events":[...] }.
//   stdout : "OK <hex-state-root>" / "ERR <CODE>@<index>" / "ERR BADCASE", in order.
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os"

	canonical "github.com/paradigm-terra/canonical-go"
	calreducer "github.com/paradigm-terra/cal-reducer-go"
)

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
	evV, _ := o.Get("events")
	events, ok := evV.([]canonical.Value)
	if !ok {
		return "ERR BADCASE"
	}
	start, _ := o.Get("start")

	state, ferr := calreducer.Materialize(events, start)
	if ferr != nil {
		return fmt.Sprintf("ERR %s@%d", ferr.Code, ferr.Index)
	}
	root, rerr := calreducer.StateRootOf(state)
	if rerr != nil {
		return "ERR BADCASE"
	}
	return "OK " + hex.EncodeToString(root[:])
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
