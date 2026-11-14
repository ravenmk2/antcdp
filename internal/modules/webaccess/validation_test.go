package webaccess

import (
	"encoding/json"
	"strings"
	"testing"

	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

func testSettings() runtime.Settings {
	return runtime.Settings{Search: runtime.SearchSettings{Routes: []runtime.RouteRef{}, MaxResults: 5}, Fetch: runtime.FetchSettings{Routes: []runtime.RouteRef{}, MaxBytes: 2 << 20, TimeoutSeconds: 20, MaxRedirects: 3, AllowedInternalHosts: []string{}}}
}
func TestSettingsRejectImplicitAndInvalidPolicy(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*runtime.Settings)
	}{
		{"missing routes", func(v *runtime.Settings) { v.Search.Routes = nil }},
		{"search builtin", func(v *runtime.Settings) { v.Search.Routes = []runtime.RouteRef{{Kind: "builtin", ID: "http"}} }},
		{"unknown reader", func(v *runtime.Settings) { v.Fetch.Routes = []runtime.RouteRef{{Kind: "builtin", ID: "https"}} }},
		{"duplicate", func(v *runtime.Settings) {
			v.Search.Routes = []runtime.RouteRef{{Kind: "provider", ID: "1"}, {Kind: "provider", ID: "1"}}
		}},
		{"noncanonical id", func(v *runtime.Settings) { v.Search.Routes = []runtime.RouteRef{{Kind: "provider", ID: "01"}} }},
		{"wildcard exception", func(v *runtime.Settings) { v.Fetch.AllowedInternalHosts = []string{"*.corp.example"} }},
		{"URL exception", func(v *runtime.Settings) { v.Fetch.AllowedInternalHosts = []string{"https://corp.example"} }},
		{"duplicate canonical host", func(v *runtime.Settings) { v.Fetch.AllowedInternalHosts = []string{"HOST.example.", "host.example"} }},
		{"oversize", func(v *runtime.Settings) { v.Fetch.MaxBytes = 11 << 20 }},
		{"unbounded timeout", func(v *runtime.Settings) { v.Fetch.TimeoutSeconds = 0 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := testSettings()
			tc.mutate(&v)
			if NormalizeSettings(&v) == nil {
				t.Fatal("invalid policy accepted")
			}
		})
	}
	good := testSettings()
	good.Fetch.AllowedInternalHosts = []string{"HOST.example."}
	if e := NormalizeSettings(&good); e != nil || good.Fetch.AllowedInternalHosts[0] != "host.example" {
		t.Fatal("host normalization", e)
	}
}
func TestSettingsWriteRequiresExplicitLimits(t *testing.T) {
	good := `{"search":{"routes":[],"max_results":5},"fetch":{"routes":[],"max_bytes":2097152,"timeout_seconds":20,"max_redirects":0,"allowed_internal_hosts":[]}}`
	var v SettingsWrite
	if e := json.Unmarshal([]byte(good), &v); e != nil {
		t.Fatal(e)
	}
	for _, body := range []string{strings.Replace(good, `"max_redirects":0,`, "", 1), strings.Replace(good, `"max_redirects":0`, `"max_redirects":null`, 1), strings.Replace(good, `"max_results":5`, `"max_results":5,"unexpected":true`, 1)} {
		if json.Unmarshal([]byte(body), &v) == nil {
			t.Fatal("incomplete or unknown policy accepted")
		}
	}
}
func TestProviderAuthenticationAndURLValidation(t *testing.T) {
	for _, url := range []string{"https://user:secret@example.com", "https://example.com?secret=x", "https://example.com#fragment", "file:///data", "https://example.com:70000", "https://example.com\\private"} {
		c := Config{BaseURL: url, Timeout: 15}
		if validateConfig(&c) == nil {
			t.Fatalf("invalid URL accepted %q", url)
		}
	}
	for _, value := range []string{"", "secret\nvalue", "secret\x00value", strings.Repeat("a", 8193)} {
		a := AuthenticationWrite{Method: "api_key"}
		a.Secret.Operation = "replace"
		a.Secret.Value = &value
		if validateAuth(&a, true) == nil {
			t.Fatal("invalid secret accepted")
		}
	}
	var c Config
	if json.Unmarshal([]byte(`{"base_url":"https://example.com"}`), &c) != nil || c.Timeout != 15 {
		t.Fatal("missing default")
	}
	if json.Unmarshal([]byte(`{"base_url":"https://example.com","timeout_seconds":null}`), &c) == nil {
		t.Fatal("null timeout accepted")
	}
}
