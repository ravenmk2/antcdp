package webaccess

import (
	"bytes"
	"encoding/json"
	"fmt"

	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

func (c *Config) UnmarshalJSON(b []byte) error {
	var v struct {
		BaseURL string     `json:"base_url"`
		Timeout Field[int] `json:"timeout_seconds"`
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(&v); e != nil {
		return e
	}
	if v.Timeout.Null {
		return fmt.Errorf("timeout cannot be null")
	}
	c.BaseURL = v.BaseURL
	c.Timeout = 15
	if v.Timeout.Set {
		c.Timeout = v.Timeout.Value
	}
	return nil
}

// SettingsWrite distinguishes a chosen zero-redirect policy from an omitted
// field. Runtime Settings remains a plain reusable Go value.
type SettingsWrite struct{ runtime.Settings }

func (w *SettingsWrite) UnmarshalJSON(b []byte) error {
	var raw map[string]json.RawMessage
	if json.Unmarshal(b, &raw) != nil || len(raw) != 2 {
		return fmt.Errorf("invalid settings")
	}
	for section, keys := range map[string][]string{"search": {"routes", "max_results"}, "fetch": {"routes", "max_bytes", "timeout_seconds", "max_redirects", "allowed_internal_hosts"}} {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw[section], &fields) != nil || len(fields) != len(keys) {
			return fmt.Errorf("incomplete settings")
		}
		for _, key := range keys {
			value, ok := fields[key]
			if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return fmt.Errorf("missing setting")
			}
		}
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	return d.Decode(&w.Settings)
}
