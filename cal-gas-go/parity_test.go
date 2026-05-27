package calgas

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"

	canonical "github.com/paradigm-terra/canonical-go"
)

// Byte-for-byte parity against the TypeScript reference golden vectors
// (../cal-gas/vectors/golden.json): every gas unit (static + total), gas price,
// flat fee, max-expected gas, escrow, the §9.3 admission gate, and the full
// §9.4 GasBill for each of the five outcomes.

type goldenDoc struct {
	Vectors []struct {
		ID             string `json:"id"`
		CalCanonical   string `json:"cal_canonical"`
		StateCanonical string `json:"state_canonical"`
		BytesWritten   string `json:"bytes_written"`
		Output         struct {
			StaticGasUnits string `json:"static_gas_units"`
			GasUnits       string `json:"gas_units"`
			GasPrice       string `json:"gas_price"`
			FlatFee        string `json:"flat_fee"`
			MaxExpectedGas string `json:"max_expected_gas"`
			Escrow         string `json:"escrow"`
			CanValidate    bool   `json:"can_validate"`
			Bills          map[string]struct {
				FeeRetained        string `json:"feeRetained"`
				DynamicGasConsumed string `json:"dynamicGasConsumed"`
				GasRefunded        string `json:"gasRefunded"`
				TotalAgentCharge   string `json:"totalAgentCharge"`
			} `json:"bills"`
		} `json:"output"`
	} `json:"vectors"`
}

func TestParityWithTypeScriptGoldenVectors(t *testing.T) {
	data, err := os.ReadFile("../cal-gas/vectors/golden.json")
	if err != nil {
		t.Fatalf("read golden.json: %v", err)
	}
	var doc goldenDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse golden.json: %v", err)
	}
	if len(doc.Vectors) < 5 {
		t.Fatalf("expected at least 5 gas vectors, got %d", len(doc.Vectors))
	}
	checks := 0
	outcomes := []Outcome{Finalized, FailedPrecond, FailedNoCharge, FailedExec, ExpiredPre, ExpiredPost}

	for _, v := range doc.Vectors {
		cal, e1 := canonical.ParseCanonical(v.CalCanonical)
		if e1 != nil {
			t.Fatalf("%s: parse cal: %v", v.ID, e1)
		}
		state, e2 := canonical.ParseCanonical(v.StateCanonical)
		if e2 != nil {
			t.Fatalf("%s: parse state: %v", v.ID, e2)
		}
		bytes, ok := new(big.Int).SetString(v.BytesWritten, 10)
		if !ok {
			t.Fatalf("%s: bad bytes_written %q", v.ID, v.BytesWritten)
		}
		fee := FlatValidationFee(state)

		check := func(name, got, want string) {
			checks++
			if got != want {
				t.Errorf("%s/%s: got %s want %s", v.ID, name, got, want)
			}
		}

		su, ge := StaticGasUnits(cal)
		if ge != nil {
			t.Fatalf("%s: static: %v", v.ID, ge)
		}
		check("static_gas_units", su.String(), v.Output.StaticGasUnits)

		gu, ge := GasUnits(cal, bytes)
		if ge != nil {
			t.Fatalf("%s: total: %v", v.ID, ge)
		}
		check("gas_units", gu.String(), v.Output.GasUnits)
		check("gas_price", GasPrice(state).String(), v.Output.GasPrice)
		check("flat_fee", fee.String(), v.Output.FlatFee)
		check("max_expected_gas", MaxExpectedDynamicGas(cal, fee).String(), v.Output.MaxExpectedGas)
		check("escrow", EscrowRequirement(cal, state).String(), v.Output.Escrow)

		checks++
		if got := CanValidate(cal, state); got != v.Output.CanValidate {
			t.Errorf("%s/can_validate: got %v want %v", v.ID, got, v.Output.CanValidate)
		}

		for _, oc := range outcomes {
			b, ge := Settle(oc, cal, state, bytes)
			if ge != nil {
				t.Fatalf("%s/%s: settle: %v", v.ID, oc, ge)
			}
			w := v.Output.Bills[string(oc)]
			check(string(oc)+"/feeRetained", b.FeeRetained.String(), w.FeeRetained)
			check(string(oc)+"/dynamicGasConsumed", b.DynamicGasConsumed.String(), w.DynamicGasConsumed)
			check(string(oc)+"/gasRefunded", b.GasRefunded.String(), w.GasRefunded)
			check(string(oc)+"/totalAgentCharge", b.TotalAgentCharge.String(), w.TotalAgentCharge)
		}
	}

	if !t.Failed() {
		t.Logf("All %d gas parity checks passed against TypeScript golden vectors.", checks)
	}
}
