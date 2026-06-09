module github.com/paradigm-terra/orchestrator-go

go 1.26.3

require (
	github.com/paradigm-terra/cal-go v0.0.0
	github.com/paradigm-terra/cal-reducer-go v0.0.0
	github.com/paradigm-terra/cal-validator-go v0.0.0
	github.com/paradigm-terra/canonical-go v0.0.0
	github.com/paradigm-terra/tc-v2-verify-go v0.0.0
)

require (
	github.com/paradigm-terra/cal-gas-go v0.0.0 // indirect
	github.com/paradigm-terra/dsl-go v0.0.0 // indirect
	golang.org/x/text v0.37.0 // indirect
)

replace github.com/paradigm-terra/canonical-go => ../canonical-go

replace github.com/paradigm-terra/dsl-go => ../dsl-go

replace github.com/paradigm-terra/cal-gas-go => ../cal-gas-go

replace github.com/paradigm-terra/cal-go => ../cal-go

replace github.com/paradigm-terra/cal-reducer-go => ../cal-reducer-go

replace github.com/paradigm-terra/cal-validator-go => ../cal-validator-go

replace github.com/paradigm-terra/tc-v2-verify-go => ../tc-v2-verify-go
