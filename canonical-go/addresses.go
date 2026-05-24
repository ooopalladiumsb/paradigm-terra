package canonical

import (
	"strconv"
	"strings"
)

// ParsedAddress is a canonical raw TON address.
type ParsedAddress struct {
	Workchain int
	Hash      [32]byte
}

// ParseAddress parses a canonical raw TON address of the form
// <workchain>:<64 lowercase hex>. It rejects uppercase hex, base64, a missing
// colon, the wrong hash length, or a workchain outside the int8 range.
func ParseAddress(addr string) (ParsedAddress, error) {
	var p ParsedAddress
	noncanon := func() error {
		return encodingErr("ADDRESS_NONCANONICAL",
			"address "+strconv.Quote(addr)+" is not canonical raw <workchain>:<64-hex-lowercase>")
	}

	colon := strings.IndexByte(addr, ':')
	if colon < 0 {
		return p, noncanon()
	}
	wcStr, hexStr := addr[:colon], addr[colon+1:]

	digits := wcStr
	if strings.HasPrefix(digits, "-") {
		digits = digits[1:]
	}
	if len(digits) == 0 || len(digits) > 4 {
		return p, noncanon()
	}
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return p, noncanon()
		}
	}

	if len(hexStr) != 64 {
		return p, noncanon()
	}
	for i := 0; i < len(hexStr); i++ {
		c := hexStr[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return p, noncanon()
		}
	}

	wc, err := strconv.Atoi(wcStr)
	if err != nil {
		return p, noncanon()
	}
	if wc < -128 || wc > 127 {
		return p, encodingErr("ADDRESS_WORKCHAIN_RANGE",
			"workchain "+strconv.Itoa(wc)+" outside int8 range [-128, 127]")
	}

	b, err := FromHex(hexStr)
	if err != nil {
		return p, err
	}
	p.Workchain = wc
	copy(p.Hash[:], b)
	return p, nil
}

// FormatAddress renders a parsed address back to its canonical raw form.
func FormatAddress(p ParsedAddress) string {
	return strconv.Itoa(p.Workchain) + ":" + ToHex(p.Hash[:])
}

// IsCanonicalAddress reports whether addr is a canonical raw TON address.
func IsCanonicalAddress(addr string) bool {
	_, err := ParseAddress(addr)
	return err == nil
}

// AddressToBytes returns int8(workchain) || 32-byte hash. The
// PARADIGM_TERRA_ADDRESS_V1 domain prefix is applied at hash time, not here.
func AddressToBytes(addr string) ([]byte, error) {
	p, err := ParseAddress(addr)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 33)
	out[0] = byte(int8(p.Workchain))
	copy(out[1:], p.Hash[:])
	return out, nil
}
