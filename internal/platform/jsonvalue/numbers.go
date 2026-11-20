// Package jsonvalue works with values decoded from JSON.
package jsonvalue

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// SchemaNumbers prepares decoded JSON for schema validation.
// jsonschema-go treats json.Number as a Go string. Normalize it for validation
// while sending the original JSON bytes; integers retain their exact 64-bit
// value instead of being silently rounded through float64.
func SchemaNumbers(v any) (any, error) {
	switch x := v.(type) {
	case json.Number:
		s := string(x)
		if !strings.ContainsAny(s, ".eE") {
			if n, e := strconv.ParseInt(s, 10, 64); e == nil {
				return n, nil
			}
			if n, e := strconv.ParseUint(s, 10, 64); e == nil {
				return n, nil
			}
			return nil, strconv.ErrRange
		}
		n, e := strconv.ParseFloat(s, 64)
		if e != nil || math.IsInf(n, 0) || math.IsNaN(n) {
			return nil, strconv.ErrRange
		}
		return n, nil
	case map[string]any:
		out := map[string]any{}
		for k, c := range x {
			n, e := SchemaNumbers(c)
			if e != nil {
				return nil, e
			}
			out[k] = n
		}
		return out, nil
	case []any:
		out := make([]any, len(x))
		for i, c := range x {
			n, e := SchemaNumbers(c)
			if e != nil {
				return nil, e
			}
			out[i] = n
		}
		return out, nil
	default:
		return v, nil
	}
}
