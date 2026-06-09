package canonical

import (
	"fmt"
	"sort"
)

// MCP schema-hash construction per CAL Execution Spec §4.4.1 — Go parity with mcp.ts / mcp.rs.
//
//   MCP_SCHEMA_V1_TOOLSET := canonical_json(sorted_lex(tool_names))
//   MCP_SCHEMA_HASH       := SHA256("PARADIGM_TERRA_MCP_V1" || MCP_SCHEMA_V1_TOOLSET)
//
// Tool names MUST match [A-Za-z0-9_]+ (Execution Spec v1 §9.1 ASCII identifiers).
// The function rejects: empty set, empty name, non-conforming name, duplicates.

func isValidMcpToolName(s string) bool {
	if len(s) == 0 {
		return false
	}
	for i := 0; i < len(s); i++ {
		b := s[i]
		ok := (b >= 'A' && b <= 'Z') ||
			(b >= 'a' && b <= 'z') ||
			(b >= '0' && b <= '9') ||
			b == '_'
		if !ok {
			return false
		}
	}
	return true
}

// CanonicalizeMcpToolNames validates and lex-sorts the input. The returned
// slice is a fresh allocation; the input is not mutated.
func CanonicalizeMcpToolNames(toolNames []string) ([]string, error) {
	if len(toolNames) == 0 {
		return nil, encodingErr("MCP_TOOLSET_EMPTY", "tool name set must be non-empty")
	}
	for _, name := range toolNames {
		if name == "" {
			return nil, encodingErr("MCP_TOOL_NAME_EMPTY", "tool name must be non-empty")
		}
		if !isValidMcpToolName(name) {
			return nil, encodingErr(
				"MCP_TOOL_NAME_NONCANONICAL",
				fmt.Sprintf("tool name %q must match /^[A-Za-z0-9_]+$/ (ASCII identifier per Execution Spec §9.1)", name),
			)
		}
	}
	sorted := make([]string, len(toolNames))
	copy(sorted, toolNames)
	sort.Strings(sorted)
	for i := 1; i < len(sorted); i++ {
		if sorted[i] == sorted[i-1] {
			return nil, encodingErr(
				"MCP_TOOL_NAME_DUPLICATE",
				fmt.Sprintf("duplicate tool name %q", sorted[i]),
			)
		}
	}
	return sorted, nil
}

// McpSchemaToolsetBytes returns the canonical-JSON byte payload that gets hashed.
func McpSchemaToolsetBytes(toolNames []string) ([]byte, error) {
	sorted, err := CanonicalizeMcpToolNames(toolNames)
	if err != nil {
		return nil, err
	}
	arr := make([]Value, len(sorted))
	for i, s := range sorted {
		arr[i] = s
	}
	return CanonicalizeValue([]Value(arr))
}

// ComputeMcpSchemaHash returns the 32-byte digest per CAL Spec §4.4.1.
func ComputeMcpSchemaHash(toolNames []string) ([32]byte, error) {
	var zero [32]byte
	payload, err := McpSchemaToolsetBytes(toolNames)
	if err != nil {
		return zero, err
	}
	return DomainHash(MCPV1, payload)
}
