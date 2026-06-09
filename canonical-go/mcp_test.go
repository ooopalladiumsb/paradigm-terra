package canonical

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// Byte-for-byte parity against the TS-generated MCP schema-hash vectors.

func mustReadFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(b)
}

func objGet(t *testing.T, v Value, key string) Value {
	t.Helper()
	o, ok := v.(*Object)
	if !ok {
		t.Fatalf("not an object (key=%s)", key)
	}
	val, ok := o.Get(key)
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	return val
}

func asStr(t *testing.T, v Value) string {
	t.Helper()
	s, ok := v.(string)
	if !ok {
		t.Fatalf("expected string, got %T", v)
	}
	return s
}

func asArr(t *testing.T, v Value) []Value {
	t.Helper()
	a, ok := v.([]Value)
	if !ok {
		t.Fatalf("expected array, got %T", v)
	}
	return a
}

func toolNames(t *testing.T, v Value) []string {
	t.Helper()
	arr := asArr(t, v)
	out := make([]string, len(arr))
	for i, x := range arr {
		out[i] = asStr(t, x)
	}
	return out
}

func TestMcpParityAgainstTsVectors(t *testing.T) {
	vectorsPath := filepath.Join("..", "tools", "mcp", "vectors.json")
	root, err := ParseCanonical(mustReadFile(t, vectorsPath))
	if err != nil {
		t.Fatalf("parse vectors.json: %v", err)
	}
	vectors := asArr(t, objGet(t, root, "vectors"))
	for _, v := range vectors {
		id := asStr(t, objGet(t, v, "id"))
		inputNames := toolNames(t, objGet(t, objGet(t, v, "input"), "tool_names"))
		expect := objGet(t, v, "expect")
		kind := asStr(t, objGet(t, expect, "kind"))

		t.Run(id, func(t *testing.T) {
			switch kind {
			case "ok":
				gotHash, err := ComputeMcpSchemaHash(inputNames)
				if err != nil {
					t.Fatalf("expected ok, got error: %v", err)
				}
				expectedHex := asStr(t, objGet(t, expect, "mcp_schema_hash_hex"))
				if got := hex.EncodeToString(gotHash[:]); got != expectedHex {
					t.Fatalf("hash mismatch\n  expected: %s\n  got:      %s", expectedHex, got)
				}
				expectedUTF8 := asStr(t, objGet(t, expect, "canonical_bytes_utf8"))
				gotBytes, err := McpSchemaToolsetBytes(inputNames)
				if err != nil {
					t.Fatalf("toolset bytes error: %v", err)
				}
				if string(gotBytes) != expectedUTF8 {
					t.Fatalf("canonical bytes mismatch\n  expected: %s\n  got:      %s", expectedUTF8, string(gotBytes))
				}
			case "error":
				expectedCode := asStr(t, objGet(t, expect, "error_code"))
				_, err := ComputeMcpSchemaHash(inputNames)
				if err == nil {
					t.Fatalf("expected error %s, got ok", expectedCode)
				}
				ce, ok := err.(*CanonicalError)
				if !ok {
					t.Fatalf("expected *CanonicalError, got %T: %v", err, err)
				}
				if ce.Code != expectedCode {
					t.Fatalf("expected error %s, got %s", expectedCode, ce.Code)
				}
			default:
				t.Fatalf("unknown vector kind %s", kind)
			}
		})
	}
}

func TestMcpPinnedArtifactMatches(t *testing.T) {
	pinnedPath := filepath.Join("..", "tools", "mcp", "mcp-schema-v1-tools.json")
	pinnedRaw := mustReadFile(t, pinnedPath)
	parsed, err := ParseCanonical(pinnedRaw)
	if err != nil {
		t.Fatalf("parse pinned: %v", err)
	}
	names := toolNames(t, parsed)
	bytes, err := McpSchemaToolsetBytes(names)
	if err != nil {
		t.Fatalf("toolset bytes: %v", err)
	}
	if string(bytes) != pinnedRaw {
		t.Fatalf("canonical bytes of pinned toolset must equal artifact byte-for-byte")
	}
}

func TestMcpOrderIndependenceStress(t *testing.T) {
	pinnedPath := filepath.Join("..", "tools", "mcp", "mcp-schema-v1-tools.json")
	parsed, err := ParseCanonical(mustReadFile(t, pinnedPath))
	if err != nil {
		t.Fatalf("parse pinned: %v", err)
	}
	names := toolNames(t, parsed)
	baseline, err := ComputeMcpSchemaHash(names)
	if err != nil {
		t.Fatalf("baseline: %v", err)
	}
	// Deterministic xorshift shuffle.
	var state uint64 = 0x9E3779B97F4A7C15
	for i := 0; i < 256; i++ {
		copy_ := make([]string, len(names))
		copy(copy_, names)
		for j := len(copy_) - 1; j > 0; j-- {
			state ^= state << 13
			state ^= state >> 7
			state ^= state << 17
			k := int(state) % (j + 1)
			if k < 0 {
				k += j + 1
			}
			copy_[j], copy_[k] = copy_[k], copy_[j]
		}
		h, err := ComputeMcpSchemaHash(copy_)
		if err != nil {
			t.Fatalf("shuffle %d: %v", i, err)
		}
		if h != baseline {
			t.Fatalf("shuffle %d drift", i)
		}
	}
}
