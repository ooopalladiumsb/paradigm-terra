package tcv2verify

import (
	"crypto/sha256"
	"encoding/binary"
)

// Contract B — TC_V2_TONPROOF_VERIFY_V1 (owner authentication, ton-proof-item-v2).
// Little-endian length/timestamp, no type discriminator, nested sha256. Owns its own
// encoders; shares no serialization helper with sign_data.go. encodeDomainLenB /
// encodeTimestampB are LITTLE-endian here vs big-endian in Contract A — the divergence
// that makes unifying the two a correctness bug.

const (
	tonProofPrefix = "ton-proof-item-v2/"
	tonProofOuter  = "ton-connect"
)

// TonProofInput is the input to Contract B.
type TonProofInput struct {
	Workchain    int32
	AddressHash  [32]byte
	Domain       string
	Timestamp    uint64
	ProofPayload string // the dApp nonce, signed as its literal string bytes (NOT decoded)
}

// TonProofDigest builds the Contract B message and returns its nested sha256 digest.
func TonProofDigest(in TonProofInput) [32]byte {
	domain := []byte(in.Domain)

	inner := make([]byte, 0, len(tonProofPrefix)+4+32+4+len(domain)+8+len(in.ProofPayload))
	inner = append(inner, tonProofPrefix...)
	inner = append(inner, encodeWorkchainB(in.Workchain)...)
	inner = append(inner, in.AddressHash[:]...)
	inner = append(inner, encodeDomainLenB(uint32(len(domain)))...)
	inner = append(inner, domain...)
	inner = append(inner, encodeTimestampB(in.Timestamp)...)
	inner = append(inner, in.ProofPayload...)
	innerHash := sha256.Sum256(inner)

	outer := make([]byte, 0, 2+len(tonProofOuter)+32)
	outer = append(outer, 0xff, 0xff)
	outer = append(outer, tonProofOuter...)
	outer = append(outer, innerHash[:]...)
	return sha256.Sum256(outer)
}

// Contract B field encoders — workchain big-endian; domain_len/timestamp LITTLE-endian.
// Deliberately NOT shared with sign_data.go.
func encodeWorkchainB(wc int32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, uint32(wc))
	return b
}
func encodeDomainLenB(n uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, n)
	return b
}
func encodeTimestampB(ts uint64) []byte {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, ts)
	return b
}
