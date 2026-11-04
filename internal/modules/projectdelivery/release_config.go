package projectdelivery

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"unicode/utf8"

	"github.com/pelletier/go-toml/v2"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"gopkg.in/ini.v1"
	"gopkg.in/yaml.v3"
)

func validateConfigFile(root *os.Root, key string, info MaterialInfo) error {
	f, e := root.Open(key)
	if e != nil {
		return e
	}
	defer func() { _ = f.Close() }()
	// Limit parser allocations separately from the binary attachment limit.
	const maxText = 1 << 20
	b, e := io.ReadAll(io.LimitReader(f, maxText+1))
	if e != nil {
		return e
	}
	if len(b) > maxText {
		return httpx.Invalid("content", "config_too_large")
	}
	if !utf8.Valid(b) || len(bytes.TrimSpace(b)) == 0 {
		return httpx.Invalid("content", "invalid_text")
	}
	_, e = parseConfig(b, info)
	return e
}
func parseConfig(b []byte, info MaterialInfo) (any, error) {
	var e error
	var value any
	switch info.Format {
	case "json":
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.UseNumber()
		e = json.Unmarshal(b, new(json.RawMessage))
		if e == nil {
			e = checkJSONKeys(dec, 0)
		}
		if e == nil {
			dec = json.NewDecoder(bytes.NewReader(b))
			dec.UseNumber()
			e = dec.Decode(&value)
		}
	case "yaml":
		dec := yaml.NewDecoder(bytes.NewReader(b))
		e = dec.Decode(&value)
		if e == nil && !errors.Is(dec.Decode(new(any)), io.EOF) {
			return nil, httpx.Invalid("content", "single_document_required")
		}
	case "toml":
		var table map[string]any
		e = toml.Unmarshal(b, &table)
		value = table
	case "ini":
		var f *ini.File
		f, e = ini.LoadSources(ini.LoadOptions{AllowShadows: true}, b)
		sections := map[string]any{}
		if e == nil {
			for _, section := range f.Sections() {
				keys := map[string]any{}
				for _, key := range section.Keys() {
					if len(key.ValueWithShadows()) > 1 {
						return nil, httpx.Invalid("content", "duplicate_key")
					}
					keys[key.Name()] = key.Value()
				}
				sections[section.Name()] = keys
			}
		}
		value = sections
	case "properties":
		value, e = propertyPairs(b)
	default:
		return nil, httpx.Invalid("config_format", "unsupported")
	}
	if e != nil {
		return nil, configIssue(info.Format, b, e)
	}
	if info.Mode == "delta" {
		if _, ok := value.(map[string]any); !ok {
			return nil, httpx.Invalid("content", "root_mapping_required")
		}
	}
	return value, nil
}
