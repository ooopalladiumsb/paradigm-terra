package canonical

import (
	"bytes"
	"fmt"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// UTF8NFCBytes NFC-normalizes s and returns its UTF-8 bytes. It errors if s
// begins with a BOM (U+FEFF). Go strings are always valid UTF-8 and cannot hold
// lone surrogates, so those checks from the TS reference are unreachable here.
//
// NOTE on Unicode version: NFC tables come from golang.org/x/text. The TS
// reference pins Unicode 15.1 (Node 22, ICU 73+). For full conformance the
// x/text version's Unicode tables must match; all current NFC golden vectors
// (U+0065 U+0301 → U+00E9) are stable across Unicode versions.
func UTF8NFCBytes(s string) ([]byte, error) {
	if strings.HasPrefix(s, "\uFEFF") {
		return nil, noncanonical("UTF8_BOM_FORBIDDEN", "BOM at start of string is forbidden")
	}
	if err := assertAssigned(s); err != nil {
		return nil, err
	}
	return []byte(norm.NFC.String(s)), nil
}

// assertAssigned enforces the CE v1.3 \u00A73.2 domain restriction: a canonical
// string MUST contain only code points assigned as of Unicode 15.1. This keeps
// NFC identical across the TS/Rust/Go backends despite their differing Unicode
// versions (by the Unicode Normalization Stability Policy). It returns an error
// on the first unassigned scalar.
func assertAssigned(s string) error {
	for _, r := range s {
		if !isAssignedCodePoint(r) {
			return noncanonical("UTF8_UNASSIGNED_CODEPOINT",
				fmt.Sprintf("code point U+%04X is not assigned as of Unicode 15.1", r))
		}
	}
	return nil
}

// CompareNFC compares two strings by their NFC UTF-8 byte sequences.
func CompareNFC(a, b string) (int, error) {
	ab, err := UTF8NFCBytes(a)
	if err != nil {
		return 0, err
	}
	bb, err := UTF8NFCBytes(b)
	if err != nil {
		return 0, err
	}
	return bytes.Compare(ab, bb), nil
}

// nfcBytes is the non-erroring NFC byte form used for JCS key ordering and
// byte emission. The leading-BOM rejection (CE §3.2) is applied separately in
// escapeString, which every JSON key and value passes through.
func nfcBytes(s string) []byte {
	return []byte(norm.NFC.String(s))
}
