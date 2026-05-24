package canonical

import (
	"encoding/binary"
	"encoding/hex"
	"math/big"
	"strings"
)

var (
	two256     = new(big.Int).Lsh(big.NewInt(1), 256)
	maxUint256 = new(big.Int).Sub(two256, big.NewInt(1))
	two255     = new(big.Int).Lsh(big.NewInt(1), 255)
	maxInt256  = new(big.Int).Sub(two255, big.NewInt(1))
	minInt256  = new(big.Int).Neg(two255)
)

// EncodeUint256Dec encodes a non-negative decimal string as uint256 (32 bytes
// big-endian).
func EncodeUint256Dec(s string) ([32]byte, error) {
	var out [32]byte
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return out, encodingErr("UINT256_OUT_OF_RANGE", "invalid decimal: "+s)
	}
	if n.Sign() < 0 || n.Cmp(maxUint256) > 0 {
		return out, encodingErr("UINT256_OUT_OF_RANGE", "uint256 must be 0..2^256-1, got "+s)
	}
	n.FillBytes(out[:])
	return out, nil
}

// EncodeInt256Dec encodes a signed decimal string as int256 (32 bytes
// big-endian, two's complement). Range is [-2^255, 2^255-1].
func EncodeInt256Dec(s string) ([32]byte, error) {
	var out [32]byte
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return out, encodingErr("INT256_OUT_OF_RANGE", "invalid decimal: "+s)
	}
	if n.Cmp(minInt256) < 0 || n.Cmp(maxInt256) > 0 {
		return out, encodingErr("INT256_OUT_OF_RANGE", "int256 out of range, got "+s)
	}
	v := n
	if n.Sign() < 0 {
		// two's complement: value + 2^256
		v = new(big.Int).Add(n, two256)
	}
	v.FillBytes(out[:])
	return out, nil
}

// EncodeUint64 encodes v as 8 big-endian bytes.
func EncodeUint64(v uint64) [8]byte {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], v)
	return b
}

// EncodeUint16 encodes v as 2 big-endian bytes.
func EncodeUint16(v uint16) [2]byte {
	var b [2]byte
	binary.BigEndian.PutUint16(b[:], v)
	return b
}

// EncodeUint8 encodes v as a single byte.
func EncodeUint8(v uint8) [1]byte {
	return [1]byte{v}
}

// ToHex returns lowercase fixed-width hex with no prefix.
func ToHex(b []byte) string {
	return hex.EncodeToString(b)
}

// ToHexPrefixed returns lowercase fixed-width hex with a 0x prefix.
func ToHexPrefixed(b []byte) string {
	return "0x" + hex.EncodeToString(b)
}

// FromHex decodes hex (with or without a 0x/0X prefix) into bytes.
func FromHex(s string) ([]byte, error) {
	stripped := s
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
		stripped = s[2:]
	}
	if len(stripped)%2 != 0 {
		return nil, encodingErr("HEX_ODD_LENGTH", "hex string must have even length")
	}
	b, err := hex.DecodeString(stripped)
	if err != nil {
		return nil, encodingErr("HEX_INVALID_CHAR", "invalid hex: "+err.Error())
	}
	return b, nil
}
