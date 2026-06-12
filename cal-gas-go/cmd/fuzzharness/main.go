// Differential-fuzz harness for the Go parity gas layer.
//
// Shares the line protocol documented in cal-gas/fuzz/ts_harness.mjs:
//   stdin  : one case per line — hex of canonical-JSON { cal, state, bytes_written }.
//   stdout : "OK <su> <gu> <esc> <cv> <FIN> <FP> <FNC> <FE> <EPRE> <EPOST>"
//            / "ERR BADCASE" / "ERR COMPUTE", in order. Each outcome is the bill
//            `feeRet,gasCons,gasRef,total`; cv is 1/0; all values decimal uint256.
package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"strings"

	calgas "github.com/paradigm-terra/cal-gas-go"
	canonical "github.com/paradigm-terra/canonical-go"
)

var outcomes = []calgas.Outcome{
	calgas.Finalized, calgas.FailedPrecond, calgas.FailedNoCharge,
	calgas.FailedExec, calgas.ExpiredPre, calgas.ExpiredPost,
}

func quad(b *calgas.GasBill) string {
	return b.FeeRetained.String() + "," + b.DynamicGasConsumed.String() + "," + b.GasRefunded.String() + "," + b.TotalAgentCharge.String()
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
	state, ok2 := o.Get("state")
	bwV, ok3 := o.Get("bytes_written")
	if !ok1 || !ok2 || !ok3 {
		return "ERR BADCASE"
	}
	bwInt, ok := bwV.(canonical.Int)
	if !ok {
		return "ERR BADCASE"
	}
	bytes, ok := new(big.Int).SetString(string(bwInt), 10)
	if !ok {
		return "ERR BADCASE"
	}

	su, e1 := calgas.StaticGasUnits(cal)
	if e1 != nil {
		return "ERR COMPUTE"
	}
	gu, e2 := calgas.GasUnits(cal, bytes, big.NewInt(0))
	if e2 != nil {
		return "ERR COMPUTE"
	}
	esc := calgas.EscrowRequirement(cal, state)
	cv := "0"
	if calgas.CanValidate(cal, state) {
		cv = "1"
	}
	bills := make([]string, 0, len(outcomes))
	for _, oc := range outcomes {
		b, e := calgas.Settle(oc, cal, state, bytes, big.NewInt(0))
		if e != nil {
			return "ERR COMPUTE"
		}
		bills = append(bills, quad(b))
	}
	return fmt.Sprintf("OK %s %s %s %s %s", su.String(), gu.String(), esc.String(), cv, strings.Join(bills, " "))
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
