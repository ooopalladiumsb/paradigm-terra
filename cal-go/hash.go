package cal

import canonical "github.com/paradigm-terra/canonical-go"

// CanonicalUnsignedBytes is the signature-free byte string a CAL hashes and is
// signed over (§8.3): the CAL with the "signatures" key omitted, canonicalized.
func CanonicalUnsignedBytes(cal canonical.Value) ([]byte, error) {
	if o, ok := cal.(*canonical.Object); ok {
		var pairs []canonical.Pair
		for _, k := range o.Keys() {
			if k == "signatures" {
				continue
			}
			v, _ := o.Get(k)
			pairs = append(pairs, canonical.P(k, v))
		}
		return canonical.CanonicalizeValue(canonical.NewObject(pairs...))
	}
	return canonical.CanonicalizeValue(cal)
}

// CalHash = SHA256("PARADIGM_TERRA_CAL_V1" || CanonicalUnsignedBytes) (§2.2).
func CalHash(cal canonical.Value) ([32]byte, error) {
	b, err := CanonicalUnsignedBytes(cal)
	if err != nil {
		return [32]byte{}, err
	}
	return canonical.DomainHash(canonical.CALV1, b)
}

// EventHash = SHA256("PARADIGM_TERRA_EVENT_V1" || canonical_bytes(event)).
func EventHash(event canonical.Value) ([32]byte, error) {
	b, err := canonical.CanonicalizeValue(event)
	if err != nil {
		return [32]byte{}, err
	}
	return canonical.DomainHash(canonical.EventV1, b)
}

// ReceiptHash = SHA256("PARADIGM_TERRA_RECEIPT_V1" || canonical_bytes(event)) (§5).
func ReceiptHash(event canonical.Value) ([32]byte, error) {
	b, err := canonical.CanonicalizeValue(event)
	if err != nil {
		return [32]byte{}, err
	}
	return canonical.DomainHash(canonical.ReceiptV1, b)
}
