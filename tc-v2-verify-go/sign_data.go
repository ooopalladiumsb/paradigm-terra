// Package tcv2verify is the Go reference for the two TC v2 owner-signature contracts.
//
// Contract A — TC_V2_SIGNDATA_VERIFY_V1 — lives in this file.
// Contract B — TC_V2_TONPROOF_VERIFY_V1 — lives in ton_proof.go.
//
// Implemented from the normative draft (docs/draft/tc-v2-sig-verify-v1-draft.md), NOT
// ported from the TS or Rust implementations — so agreement across the three is evidence
// the draft is unambiguous, not evidence that one port copied another.
//
// The two contracts share NO serialization/endian/hash-pipeline helper and there is no
// universal verifier facade (docs/spec/tc-v2-contract-boundaries.md). Each file owns its
// own encoders. crypto/sha256 and crypto/ed25519 are contract-agnostic primitives.
package tcv2verify

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
)

const signDataSchemaPrefix = "ton-connect/sign-data/"

// SignDataInput is the input to Contract A.
type SignDataInput struct {
	Workchain   int32
	AddressHash [32]byte
	Domain      string
	Timestamp   uint64
	PayloadType string // "text" | "binary"
	PayloadText string // used when PayloadType == "text"
	PayloadB64  string // used when PayloadType == "binary" (standard base64)
}

// SignDataDigest builds the Contract A message and returns its sha256 digest (single
// envelope, big-endian length/timestamp, "txt"/"bin" discriminator).
func SignDataDigest(in SignDataInput) [32]byte {
	var tag, payload []byte
	if in.PayloadType == "text" {
		tag = []byte("txt")
		payload = []byte(in.PayloadText)
	} else {
		tag = []byte("bin")
		payload, _ = base64.StdEncoding.DecodeString(in.PayloadB64)
	}
	domain := []byte(in.Domain)

	msg := make([]byte, 0, 2+len(signDataSchemaPrefix)+4+32+4+len(domain)+8+3+4+len(payload))
	msg = append(msg, 0xff, 0xff)
	msg = append(msg, signDataSchemaPrefix...)
	msg = append(msg, encodeWorkchainA(in.Workchain)...)
	msg = append(msg, in.AddressHash[:]...)
	msg = append(msg, encodeDomainLenA(uint32(len(domain)))...)
	msg = append(msg, domain...)
	msg = append(msg, encodeTimestampA(in.Timestamp)...)
	msg = append(msg, tag...)
	msg = append(msg, encodePayloadLenA(uint32(len(payload)))...)
	msg = append(msg, payload...)
	return sha256.Sum256(msg)
}

// Contract A field encoders — big-endian. Deliberately NOT shared with ton_proof.go.
func encodeWorkchainA(wc int32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, uint32(wc))
	return b
}
func encodeDomainLenA(n uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, n)
	return b
}
func encodeTimestampA(ts uint64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, ts)
	return b
}
func encodePayloadLenA(n uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, n)
	return b
}
