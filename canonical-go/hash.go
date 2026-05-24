package canonical

import "crypto/sha256"

// SHA256 returns the SHA-256 digest of b.
func SHA256(b []byte) [32]byte {
	return sha256.Sum256(b)
}

// DomainHash computes SHA256(domain || payload) per CE §7. domain MUST be an
// ASCII literal; non-ASCII tags are rejected.
func DomainHash(domain string, payload []byte) ([32]byte, error) {
	var zero [32]byte
	if !IsASCIIDomainTag(domain) {
		return zero, encodingErr("DOMAIN_TAG_NONCANONICAL", "domain tag must be ASCII, got "+domain)
	}
	buf := make([]byte, 0, len(domain)+len(payload))
	buf = append(buf, domain...)
	buf = append(buf, payload...)
	return sha256.Sum256(buf), nil
}

// ConcatBytes joins the given byte slices into a single buffer.
func ConcatBytes(parts ...[]byte) []byte {
	total := 0
	for _, p := range parts {
		total += len(p)
	}
	out := make([]byte, 0, total)
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}
