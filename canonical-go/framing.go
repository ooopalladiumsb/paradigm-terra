package canonical

import (
	"encoding/binary"
	"strconv"
)

// Frame is a decoded binary frame per CE v1.3 §8.1.
type Frame struct {
	TypeTag uint16
	Version uint16
	Payload []byte
}

// EncodeFrame produces [type_tag:u16 BE][version:u16 BE][length:u32 BE][payload].
func EncodeFrame(typeTag, version uint16, payload []byte) ([]byte, error) {
	if uint64(len(payload)) > uint64(^uint32(0)) {
		return nil, encodingErr("FRAME_PAYLOAD_TOO_LARGE",
			"payload length "+strconv.Itoa(len(payload))+" exceeds 2^32-1")
	}
	out := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint16(out[0:2], typeTag)
	binary.BigEndian.PutUint16(out[2:4], version)
	binary.BigEndian.PutUint32(out[4:8], uint32(len(payload)))
	copy(out[8:], payload)
	return out, nil
}

// DecodeFrame parses a binary frame and verifies the declared length.
func DecodeFrame(b []byte) (Frame, error) {
	var f Frame
	if len(b) < 8 {
		return f, encodingErr("FRAME_TOO_SHORT",
			"frame must be at least 8 bytes, got "+strconv.Itoa(len(b)))
	}
	f.TypeTag = binary.BigEndian.Uint16(b[0:2])
	f.Version = binary.BigEndian.Uint16(b[2:4])
	length := int(binary.BigEndian.Uint32(b[4:8]))
	if len(b) != 8+length {
		return f, encodingErr("FRAME_LENGTH_MISMATCH",
			"declared length "+strconv.Itoa(length)+" does not match actual payload length "+strconv.Itoa(len(b)-8))
	}
	f.Payload = append([]byte(nil), b[8:]...)
	return f, nil
}
