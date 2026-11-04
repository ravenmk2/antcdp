package projectdelivery

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/magiconair/properties"
	"github.com/pelletier/go-toml/v2"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var lineHint = regexp.MustCompile(`(?i)line ([0-9]+)`)

func syntaxIssue(format string, line, column int) *httpx.Error {
	e := httpx.Invalid("content", "invalid_"+format)
	e.Message = strings.ToUpper(format) + " 配置语法无效"
	if line > 0 {
		e.Message += fmt.Sprintf("（第 %d 行", line)
		if column > 0 {
			e.Message += fmt.Sprintf("，第 %d 列", column)
		}
		e.Message += "）"
		e.Details[0].Context = map[string]any{"line": line, "column": column}
	}
	return e
}
func configIssue(format string, b []byte, e error) error {
	var je *json.SyntaxError
	var te *toml.DecodeError
	var api *httpx.Error
	if errors.As(e, &api) {
		return e
	}
	if errors.As(e, &je) {
		prefix := b[:max(0, min(len(b), int(je.Offset)-1))]
		return syntaxIssue(format, bytes.Count(prefix, []byte{'\n'})+1, len(prefix)-bytes.LastIndexByte(prefix, '\n'))
	}
	if errors.As(e, &te) {
		r, c := te.Position()
		return syntaxIssue(format, r, c)
	}
	if hit := lineHint.FindStringSubmatch(e.Error()); len(hit) == 2 {
		r, _ := strconv.Atoi(hit[1])
		return syntaxIssue(format, r, 0)
	}
	return syntaxIssue(format, 0, 0)
}

// Token traversal retains duplicate object members that decoding into a map would discard.
func checkJSONKeys(d *json.Decoder, depth int) error {
	if depth > 256 {
		return httpx.Invalid("content", "nesting_limit")
	}
	v, e := d.Token()
	if e != nil {
		return e
	}
	delim, ok := v.(json.Delim)
	if !ok {
		return nil
	}
	seen := map[string]bool{}
	for d.More() {
		if delim == '{' {
			k, e := d.Token()
			if e != nil {
				return e
			}
			key, ok := k.(string)
			if !ok || seen[key] {
				return httpx.Invalid("content", "duplicate_key")
			}
			seen[key] = true
		}
		if e := checkJSONKeys(d, depth+1); e != nil {
			return e
		}
	}
	_, e = d.Token()
	return e
}
func propertyPairs(b []byte) (map[string]any, error) {
	l := properties.Loader{Encoding: properties.UTF8, DisableExpansion: true}
	pairs := map[string]any{}
	// Check each logical record separately so escaped keys and continuations
	// follow the parser's own decoding and duplicate keys cannot disappear.
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(string(b), "\r\n", "\n"), "\r", "\n"), "\n")
	for n := 0; n < len(lines); n++ {
		start := n
		line := strings.TrimLeft(lines[n], " \t\f")
		if line == "" || line[0] == '#' || line[0] == '!' {
			continue
		}
		for n+1 < len(lines) && (len(lines[n])-len(strings.TrimRight(lines[n], "\\")))%2 == 1 {
			n++
		}
		props, e := l.LoadBytes([]byte(strings.Join(lines[start:n+1], "\n")))
		if e != nil {
			return nil, syntaxIssue("properties", start+1, 0)
		}
		for k, v := range props.Map() {
			if _, ok := pairs[k]; ok {
				return nil, httpx.Invalid("content", "duplicate_key")
			}
			pairs[k] = v
		}
	}
	return pairs, nil
}
