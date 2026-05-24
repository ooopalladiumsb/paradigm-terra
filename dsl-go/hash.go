package dsl

import canonical "github.com/paradigm-terra/canonical-go"

// DslHash computes DSL_HASH = SHA256("PARADIGM_TERRA_DSL_V1.x" || canonical_json(expr)).
// Canonicalization, domain separation and SHA-256 are reused from canonical-go,
// so DSL hashes are byte-identical to the encoding spec's restricted-JCS profile.
func DslHash(expr canonical.Value, version Version) ([32]byte, error) {
	tag := canonical.DSLV11
	if version == V12 {
		tag = canonical.DSLV12
	}
	payload, err := canonical.CanonicalizeValue(expr)
	if err != nil {
		return [32]byte{}, err
	}
	return canonical.DomainHash(tag, payload)
}
