// Differential-fuzz harness for the Go parity implementation.
//
// Shares the line protocol documented in fuzz/ts_harness.mjs:
//   stdin  : one tab-separated test case per line, all payloads hex.
//   stdout : "OK <hex>" on success, "ERR" on any rejection, one line per input.
package main

import (
	"bufio"
	"encoding/hex"
	"math/big"
	"os"
	"strings"

	canonical "github.com/paradigm-terra/canonical-go"
)

var maxU64 = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 64), big.NewInt(1))

func hexToBytes(h string) ([]byte, error) {
	if h == "" {
		return []byte{}, nil
	}
	return hex.DecodeString(h)
}

func mustStr(h string) (string, error) {
	b, err := hexToBytes(h)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// handle runs one case, returning the output bytes or an error (=> "ERR").
func handle(line string) ([]byte, error) {
	f := strings.Split(line, "\t")
	switch f[0] {
	case "int256":
		s, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		b, err := canonical.EncodeInt256Dec(s)
		return b[:], err
	case "uint256":
		s, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		b, err := canonical.EncodeUint256Dec(s)
		return b[:], err
	case "uint64":
		s, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok || n.Sign() < 0 || n.Cmp(maxU64) > 0 {
			return nil, errBad
		}
		b := canonical.EncodeUint64(n.Uint64())
		return b[:], nil
	case "nfc":
		s, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		return canonical.UTF8NFCBytes(s)
	case "jcs":
		s, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		return canonical.CanonicalizeString(s)
	case "address":
		s, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		return canonical.AddressToBytes(s)
	case "frame":
		n, ok := new(big.Int).SetString(f[1], 10)
		if !ok || n.Sign() < 0 || n.BitLen() > 16 {
			return nil, errBad
		}
		v, ok := new(big.Int).SetString(f[2], 10)
		if !ok || v.Sign() < 0 || v.BitLen() > 16 {
			return nil, errBad
		}
		payload, err := hexToBytes("")
		if len(f) > 3 {
			payload, err = hexToBytes(f[3])
		}
		if err != nil {
			return nil, err
		}
		return canonical.EncodeFrame(uint16(n.Uint64()), uint16(v.Uint64()), payload)
	case "merkle":
		tag, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		var leaves [][32]byte
		field := ""
		if len(f) > 2 {
			field = f[2]
		}
		if field != "" {
			for _, lh := range strings.Split(field, ",") {
				lb, err := hexToBytes(lh)
				if err != nil {
					return nil, err
				}
				if len(lb) != 32 {
					return nil, errBad // wrong-length leaf: all impls reject
				}
				var a [32]byte
				copy(a[:], lb)
				leaves = append(leaves, a)
			}
		}
		root, err := canonical.BinaryMerkle(leaves, tag)
		return root[:], err
	case "domain_hash":
		tag, err := mustStr(f[1])
		if err != nil {
			return nil, err
		}
		payload := []byte{}
		if len(f) > 2 {
			payload, err = hexToBytes(f[2])
			if err != nil {
				return nil, err
			}
		}
		h, err := canonical.DomainHash(tag, payload)
		return h[:], err
	default:
		return nil, errBad
	}
}

type sentinel struct{}

func (sentinel) Error() string { return "bad" }

var errBad = sentinel{}

func main() {
	r := bufio.NewScanner(os.Stdin)
	r.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for r.Scan() {
		line := r.Text()
		if line == "" {
			continue
		}
		out, err := handle(line)
		if err != nil {
			w.WriteString("ERR\n")
		} else {
			w.WriteString("OK ")
			w.WriteString(hex.EncodeToString(out))
			w.WriteByte('\n')
		}
	}
}
