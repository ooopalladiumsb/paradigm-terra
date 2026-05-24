package canonical

import (
	"bytes"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Value is one JCS value: nil (null), bool, string, Int, []Value, or *Object.
type Value = any

// Int is a canonical decimal integer text (e.g. "-1", "0", "42"). Stored as a
// string rather than a bignum because a validated canonical integer round-trips
// through any integer type as the identity, exactly matching the TS bigint path.
type Int string

// Pair is one key/value entry for constructing an Object.
type Pair struct {
	Key string
	Val Value
}

// Object is an insertion-ordered key/value map; serialization sorts keys by
// UTF-8 byte order.
type Object struct {
	keys []string
	m    map[string]Value
}

// NewObject builds an Object from ordered pairs (no duplicate-key check; callers
// constructing values are assumed not to repeat keys).
func NewObject(pairs ...Pair) *Object {
	o := &Object{m: make(map[string]Value, len(pairs))}
	for _, p := range pairs {
		o.keys = append(o.keys, p.Key)
		o.m[p.Key] = p.Val
	}
	return o
}

func (o *Object) addParsed(key string, v Value) error {
	if _, ok := o.m[key]; ok {
		return noncanonical("JCS_DUPLICATE_KEY", "duplicate key "+strconv.Quote(key))
	}
	o.keys = append(o.keys, key)
	o.m[key] = v
	return nil
}

// Get returns the value for key, if present.
func (o *Object) Get(key string) (Value, bool) {
	v, ok := o.m[key]
	return v, ok
}

// Construction helpers for building values (used by tests / callers).

// P builds a Pair.
func P(k string, v Value) Pair { return Pair{Key: k, Val: v} }

// O builds an Object value from ordered pairs.
func O(pairs ...Pair) Value { return NewObject(pairs...) }

// A builds an array value.
func A(items ...Value) Value {
	if items == nil {
		return []Value{}
	}
	return []Value(items)
}

// IntU builds an integer value from an unsigned 64-bit number.
func IntU(n uint64) Value { return Int(strconv.FormatUint(n, 10)) }

// ============================================================================
// Parser (string -> Value) with duplicate-key detection
// ============================================================================

type jcsParser struct {
	src []rune
	pos int
}

func (p *jcsParser) parse() (Value, error) {
	p.skipWhitespace()
	v, err := p.parseValue()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	if p.pos != len(p.src) {
		return nil, noncanonical("JCS_TRAILING_INPUT", "unexpected character at position "+strconv.Itoa(p.pos))
	}
	return v, nil
}

func (p *jcsParser) parseValue() (Value, error) {
	p.skipWhitespace()
	c, ok := p.peek()
	if !ok {
		return nil, noncanonical("JCS_UNEXPECTED_EOF", "unexpected end of input")
	}
	switch {
	case c == '{':
		return p.parseObject()
	case c == '[':
		return p.parseArray()
	case c == '"':
		return p.parseString()
	case c == 't' || c == 'f':
		return p.parseBool()
	case c == 'n':
		return p.parseNull()
	case c == '-' || (c >= '0' && c <= '9'):
		return p.parseNumber()
	default:
		return nil, noncanonical("JCS_UNEXPECTED_CHAR",
			"unexpected character at position "+strconv.Itoa(p.pos)+": "+string(c))
	}
}

func (p *jcsParser) parseObject() (Value, error) {
	if err := p.expect('{'); err != nil {
		return nil, err
	}
	out := &Object{m: make(map[string]Value)}
	p.skipWhitespace()
	if c, ok := p.peek(); ok && c == '}' {
		p.pos++
		return out, nil
	}
	for {
		p.skipWhitespace()
		if c, ok := p.peek(); !ok || c != '"' {
			return nil, noncanonical("JCS_KEY_NOT_STRING", "expected string key at position "+strconv.Itoa(p.pos))
		}
		key, err := p.parseString()
		if err != nil {
			return nil, err
		}
		p.skipWhitespace()
		if err := p.expect(':'); err != nil {
			return nil, err
		}
		val, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		if err := out.addParsed(key, val); err != nil {
			return nil, err
		}
		p.skipWhitespace()
		c, ok := p.peek()
		switch {
		case ok && c == ',':
			p.pos++
			continue
		case ok && c == '}':
			p.pos++
			return out, nil
		default:
			return nil, noncanonical("JCS_EXPECTED_COMMA_OR_BRACE", "expected ',' or '}' at position "+strconv.Itoa(p.pos))
		}
	}
}

func (p *jcsParser) parseArray() (Value, error) {
	if err := p.expect('['); err != nil {
		return nil, err
	}
	out := []Value{}
	p.skipWhitespace()
	if c, ok := p.peek(); ok && c == ']' {
		p.pos++
		return out, nil
	}
	for {
		val, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		out = append(out, val)
		p.skipWhitespace()
		c, ok := p.peek()
		switch {
		case ok && c == ',':
			p.pos++
			continue
		case ok && c == ']':
			p.pos++
			return out, nil
		default:
			return nil, noncanonical("JCS_EXPECTED_COMMA_OR_BRACKET", "expected ',' or ']' at position "+strconv.Itoa(p.pos))
		}
	}
}

func (p *jcsParser) parseString() (string, error) {
	if err := p.expect('"'); err != nil {
		return "", err
	}
	var sb strings.Builder
	for {
		c, ok := p.peek()
		if !ok {
			return "", noncanonical("JCS_STRING_UNTERMINATED", "unterminated string")
		}
		if c == '"' {
			p.pos++
			return sb.String(), nil
		}
		if c == '\\' {
			p.pos++
			esc, ok := p.peek()
			if !ok {
				return "", noncanonical("JCS_BAD_ESCAPE", "trailing backslash in string")
			}
			p.pos++
			switch esc {
			case '"':
				sb.WriteByte('"')
			case '\\':
				sb.WriteByte('\\')
			case '/':
				sb.WriteByte('/')
			case 'b':
				sb.WriteByte('\b')
			case 'f':
				sb.WriteByte('\f')
			case 'n':
				sb.WriteByte('\n')
			case 'r':
				sb.WriteByte('\r')
			case 't':
				sb.WriteByte('\t')
			case 'u':
				if p.pos+4 > len(p.src) {
					return "", noncanonical("JCS_BAD_UNICODE_ESCAPE", "truncated \\u escape")
				}
				hexStr := string(p.src[p.pos : p.pos+4])
				p.pos += 4
				code, err := strconv.ParseUint(hexStr, 16, 32)
				if err != nil || !isHex4(hexStr) {
					return "", noncanonical("JCS_BAD_UNICODE_ESCAPE", "invalid \\u escape: \\u"+hexStr)
				}
				if code >= 0xd800 && code <= 0xdfff {
					return "", noncanonical("JCS_SURROGATE_ESCAPE",
						"surrogate \\u escape forbidden in canonical JSON: \\u"+hexStr)
				}
				sb.WriteRune(rune(code))
			default:
				return "", noncanonical("JCS_BAD_ESCAPE", "invalid escape \\"+string(esc))
			}
			continue
		}
		if c < 0x20 {
			return "", noncanonical("JCS_CONTROL_IN_STRING",
				fmt.Sprintf("unescaped control character U+%04x", c))
		}
		// Go runes cannot be lone surrogates; raw multi-byte scalars pass through.
		sb.WriteRune(c)
		p.pos++
	}
}

func (p *jcsParser) parseNumber() (Value, error) {
	start := p.pos
	if c, ok := p.peek(); ok && c == '-' {
		p.pos++
	}
	intStart := p.pos
	c, ok := p.peek()
	switch {
	case ok && c == '0':
		p.pos++
	case ok && c >= '1' && c <= '9':
		for {
			d, ok := p.peek()
			if ok && d >= '0' && d <= '9' {
				p.pos++
			} else {
				break
			}
		}
	default:
		return nil, noncanonical("JCS_BAD_NUMBER", "invalid number at position "+strconv.Itoa(start))
	}
	if t, ok := p.peek(); ok {
		if t == '.' {
			return nil, noncanonical("JCS_FRACTIONAL_FORBIDDEN", "fractional numbers are forbidden")
		}
		if t == 'e' || t == 'E' {
			return nil, noncanonical("JCS_EXPONENT_FORBIDDEN", "exponential notation is forbidden")
		}
	}
	text := string(p.src[start:p.pos])
	digitPart := string(p.src[intStart:p.pos])
	if len(digitPart) > 1 && digitPart[0] == '0' {
		return nil, noncanonical("JCS_LEADING_ZERO", "numbers must not have leading zeros: "+text)
	}
	if text == "-0" {
		return nil, noncanonical("JCS_NEGATIVE_ZERO", "'-0' is forbidden")
	}
	return Int(text), nil
}

func (p *jcsParser) parseBool() (Value, error) {
	if p.startsWith("true") {
		p.pos += 4
		return true, nil
	}
	if p.startsWith("false") {
		p.pos += 5
		return false, nil
	}
	return nil, noncanonical("JCS_BAD_LITERAL", "invalid literal at position "+strconv.Itoa(p.pos))
}

func (p *jcsParser) parseNull() (Value, error) {
	if p.startsWith("null") {
		p.pos += 4
		return nil, nil
	}
	return nil, noncanonical("JCS_BAD_LITERAL", "invalid literal at position "+strconv.Itoa(p.pos))
}

func (p *jcsParser) startsWith(lit string) bool {
	r := []rune(lit)
	if p.pos+len(r) > len(p.src) {
		return false
	}
	for i, c := range r {
		if p.src[p.pos+i] != c {
			return false
		}
	}
	return true
}

func (p *jcsParser) skipWhitespace() {
	for {
		c, ok := p.peek()
		if ok && (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
			p.pos++
		} else {
			break
		}
	}
}

func (p *jcsParser) peek() (rune, bool) {
	if p.pos < len(p.src) {
		return p.src[p.pos], true
	}
	return 0, false
}

func (p *jcsParser) expect(c rune) error {
	if cur, ok := p.peek(); ok && cur == c {
		p.pos++
		return nil
	}
	return noncanonical("JCS_EXPECTED_CHAR", "expected '"+string(c)+"' at position "+strconv.Itoa(p.pos))
}

func isHex4(s string) bool {
	if len(s) != 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// ============================================================================
// Serializer (Value -> canonical string)
// ============================================================================

// escapeString applies RFC 8785 §3.2.2.2 minimal escaping after NFC. CE §3.2: a
// canonical string MUST NOT begin with U+FEFF (BOM); this applies to every JSON
// string token — keys and values alike — independent of object key count.
// Mid-string U+FEFF (ZWNBSP) is permitted.
func escapeString(s string, sb *strings.Builder) error {
	if strings.HasPrefix(s, "\uFEFF") {
		return noncanonical("UTF8_BOM_FORBIDDEN", "BOM at start of JSON string is forbidden")
	}
	if err := assertAssigned(s); err != nil {
		return err
	}
	n := nfcBytes(s)
	sb.WriteByte('"')
	for _, r := range string(n) {
		switch r {
		case '"':
			sb.WriteString(`\"`)
		case '\\':
			sb.WriteString(`\\`)
		case '\b':
			sb.WriteString(`\b`)
		case '\t':
			sb.WriteString(`\t`)
		case '\n':
			sb.WriteString(`\n`)
		case '\f':
			sb.WriteString(`\f`)
		case '\r':
			sb.WriteString(`\r`)
		default:
			if r < 0x20 {
				sb.WriteString(fmt.Sprintf(`\u%04x`, r))
			} else {
				sb.WriteRune(r)
			}
		}
	}
	sb.WriteByte('"')
	return nil
}

func serialize(v Value, sb *strings.Builder) error {
	switch x := v.(type) {
	case nil:
		sb.WriteString("null")
	case bool:
		if x {
			sb.WriteString("true")
		} else {
			sb.WriteString("false")
		}
	case Int:
		sb.WriteString(string(x))
	case string:
		if err := escapeString(x, sb); err != nil {
			return err
		}
	case []Value:
		sb.WriteByte('[')
		for i, item := range x {
			if i > 0 {
				sb.WriteByte(',')
			}
			if err := serialize(item, sb); err != nil {
				return err
			}
		}
		sb.WriteByte(']')
	case *Object:
		keys := append([]string(nil), x.keys...)
		sort.SliceStable(keys, func(i, j int) bool {
			return bytes.Compare(nfcBytes(keys[i]), nfcBytes(keys[j])) < 0
		})
		sb.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				sb.WriteByte(',')
			}
			if err := escapeString(k, sb); err != nil {
				return err
			}
			sb.WriteByte(':')
			if err := serialize(x.m[k], sb); err != nil {
				return err
			}
		}
		sb.WriteByte('}')
	default:
		return noncanonical("JCS_UNSUPPORTED_TYPE", fmt.Sprintf("unsupported value type %T", v))
	}
	return nil
}

// ============================================================================
// Public API
// ============================================================================

// CanonicalizeString parses a JSON string under the restricted JCS profile and
// returns canonical bytes.
func CanonicalizeString(jsonStr string) ([]byte, error) {
	p := &jcsParser{src: []rune(jsonStr)}
	v, err := p.parse()
	if err != nil {
		return nil, err
	}
	var sb strings.Builder
	if err := serialize(v, &sb); err != nil {
		return nil, err
	}
	return []byte(sb.String()), nil
}

// CanonicalizeValue serializes a typed Value canonically into bytes.
func CanonicalizeValue(v Value) ([]byte, error) {
	var sb strings.Builder
	if err := serialize(v, &sb); err != nil {
		return nil, err
	}
	return []byte(sb.String()), nil
}

// ParseCanonical parses and returns the typed value (for inspection / tests).
func ParseCanonical(jsonStr string) (Value, error) {
	p := &jcsParser{src: []rune(jsonStr)}
	return p.parse()
}
