package jobs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/robfig/cron/v3"
)

var parameterName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)
var requestKey = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func hash(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func normalize(c *Config) {
	if c.Parameters == nil {
		c.Parameters = []Parameter{}
	}
}
func validateConfig(c Config) error {
	names := map[string]bool{}
	for _, p := range c.Parameters {
		if !parameterName.MatchString(p.Name) || names[p.Name] || strings.TrimSpace(p.Label) == "" || utf8.RuneCountInString(p.Label) > 100 {
			return httpx.Invalid("parameters", "invalid_name")
		}
		names[p.Name] = true
		if !slices.Contains([]string{"text", "select", "multiselect"}, p.Type) {
			return httpx.Invalid("parameters", "invalid_type")
		}
		if p.Type != "text" && len(p.Options) == 0 {
			return httpx.Invalid("parameters", "empty_options")
		}
		choices := map[string]bool{}
		for _, option := range p.Options {
			if choices[option] || option == "" || len(option) > 4096 {
				return httpx.Invalid("parameters", "invalid_options")
			}
			choices[option] = true
		}
		if p.Default != nil {
			if err := validateValue(p, p.Default); err != nil {
				return err
			}
		}
	}
	return nil
}
func validateValue(p Parameter, raw json.RawMessage) error {
	if strings.TrimSpace(string(raw)) == "null" {
		return httpx.Invalid(p.Name, "invalid_type")
	}
	if p.Type == "multiselect" {
		var values []string
		if json.Unmarshal(raw, &values) != nil || p.Required && len(values) == 0 {
			return httpx.Invalid(p.Name, "invalid_selection")
		}
		seen := map[string]bool{}
		for _, v := range values {
			if !slices.Contains(p.Options, v) || seen[v] {
				return httpx.Invalid(p.Name, "invalid_selection")
			}
			seen[v] = true
		}
	} else {
		var v string
		if json.Unmarshal(raw, &v) != nil || p.Required && strings.TrimSpace(v) == "" {
			return httpx.Invalid(p.Name, "required_text")
		}
		if p.Type == "select" && !slices.Contains(p.Options, v) {
			return httpx.Invalid(p.Name, "invalid_selection")
		}
	}
	return nil
}
func inputs(c Config, provided map[string]json.RawMessage) (json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	known := map[string]bool{}
	for _, p := range c.Parameters {
		known[p.Name] = true
		v, exists := provided[p.Name]
		if !exists && p.Default != nil {
			v = p.Default
			exists = true
		}
		if !exists {
			if p.Required {
				return nil, httpx.Invalid(p.Name, "required")
			}
			continue
		}
		if err := validateValue(p, v); err != nil {
			return nil, err
		}
		out[p.Name] = v
	}
	for key := range provided {
		if !known[key] {
			return nil, httpx.Invalid(key, "unknown_parameter")
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, httpx.Invalid("inputs", "too_large")
	}
	return raw, nil
}

// NextCronTime returns the first cron occurrence after the given instant in the site timezone.
func NextCronTime(expression, zone string, after time.Time) (*time.Time, error) {
	if len(expression) > 128 || len(zone) > 64 {
		return nil, httpx.Invalid("cron", "invalid_length")
	}
	if len(strings.Fields(expression)) != 5 {
		return nil, httpx.Invalid("cron", "five_fields_required")
	}
	if _, err := time.LoadLocation(zone); err != nil {
		return nil, httpx.Invalid("timezone", "invalid_timezone")
	}
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse("CRON_TZ=" + zone + " " + expression)
	if err != nil {
		return nil, httpx.Invalid("cron", "invalid_cron")
	}
	next := schedule.Next(after).UTC()
	if next.IsZero() {
		return nil, httpx.Invalid("cron", "no_next_time")
	}
	return &next, nil
}
func version(got string, want uint64) error {
	if got != fmt.Sprint(want) {
		return httpx.E(412, "VERSION_CONFLICT", "配置已更新，请重新加载")
	}
	return nil
}
func now() time.Time                 { return time.Now().UTC().Truncate(time.Millisecond) }
func ptr[T any](v T) *T              { return &v }
func safeJSON(v any) json.RawMessage { raw, _ := json.Marshal(v); return raw }
