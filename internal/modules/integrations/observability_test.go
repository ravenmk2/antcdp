package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestObservabilityConfigurationAndAuthentication(t *testing.T) {
	for _, tc := range []struct {
		kind, raw string
		valid     bool
	}{
		{"openobserve", `{"base_url":"https://logs.example.com","default_organization":"default"}`, true},
		{"openobserve", `{"base_url":"https://logs.example.com","default_organization":"../admin"}`, false},
		{"openobserve", `{"base_url":"https://logs.example.com","default_organization":""}`, false},
		{"openobserve", `{"base_url":"https://logs.example.com"}`, false},
		{"elasticsearch", `{"base_url":"https://es.example.com","default_organization":"default"}`, false},
		{"gitlab", `{"base_url":"https://git.example.com","default_organization":""}`, false},
		{"elasticsearch", `{"base_url":"https://es.example.com","password":"secret"}`, false},
		{"elasticsearch", `{"base_url":"https://es.example.com/prefix"}`, true},
	} {
		_, err := DecodeConnectionConfig(tc.kind, 1, json.RawMessage(tc.raw))
		if (err == nil) != tc.valid {
			t.Errorf("%s %s: %v", tc.kind, tc.raw, err)
		}
	}
	for _, tc := range []struct {
		kind, method, identity, secret string
		valid                          bool
	}{
		{"openobserve", "openobserve_basic", `{"username":"test@example.com"}`, " x ", true},
		{"elasticsearch", "elasticsearch_basic", `{"username":"bot"}`, "x", true},
		{"elasticsearch", "elasticsearch_api_key", `{}`, "aWQ6c2VjcmV0", true},
		{"elasticsearch", "elasticsearch_api_key", `{"username":"bot"}`, "aWQ6c2VjcmV0", false},
		{"elasticsearch", "elasticsearch_api_key", `{}`, "secret-key", false},
		{"openobserve", "elasticsearch_basic", `{"username":"bot"}`, "secret", false},
		{"elasticsearch", "elasticsearch_basic", `{"username":"bot"}`, "", false},
	} {
		err := validateAuthenticationFor(tc.kind, &Authentication{Method: tc.method, Identity: json.RawMessage(tc.identity), Secret: &TokenSecret{Token: tc.secret}})
		if (err == nil) != tc.valid {
			t.Errorf("%s %s: %v", tc.kind, tc.method, err)
		}
	}
}
func TestObservabilityProbes(t *testing.T) {
	for _, tc := range []struct {
		name, kind, user, secret, path, body, status, auth string
		code                                               int
	}{
		{"oo health", "openobserve", "", "", "/prefix/healthz", `{"status":"ok"}`, "succeeded", "", 200},
		{"oo empty streams", "openobserve", "bot", "pass", "/prefix/api/default/streams", `{"list":[]}`, "succeeded", "valid", 200},
		{"oo forbidden", "openobserve", "bot", "pass", "/prefix/api/default/streams", `{"error":"private"}`, "failed", "unknown", 403},
		{"oo wrong password", "openobserve", "bot", "pass", "/prefix/api/default/streams", `{}`, "failed", "invalid", 401},
		{"oo missing org", "openobserve", "bot", "pass", "/prefix/api/default/streams", `{}`, "failed", "unknown", 404},
		{"oo invalid list", "openobserve", "bot", "pass", "/prefix/api/default/streams", `{"list":null}`, "failed", "unknown", 200},
		{"es7 anonymous", "elasticsearch", "", "", "/prefix/", `{"version":{"number":"7.17.29"},"tagline":"You Know, for Search"}`, "succeeded", "", 200},
		{"es8 anonymous", "elasticsearch", "", "", "/prefix/", `{"version":{"number":"8.19.0"},"tagline":"You Know, for Search"}`, "succeeded", "", 200},
		{"es9 anonymous", "elasticsearch", "", "", "/prefix/", `{"version":{"number":"9.0.0"},"tagline":"You Know, for Search"}`, "succeeded", "", 200},
		{"es basic", "elasticsearch", "bot", "pass", "/prefix/_security/_authenticate", `{"username":"bot","authentication_type":"realm"}`, "succeeded", "valid", 200},
		{"es key", "elasticsearch", "", "aWQ6c2VjcmV0", "/prefix/_security/_authenticate", `{"username":"owner","authentication_type":"api_key","api_key":{"id":"id"}}`, "succeeded", "valid", 200},
		{"es wrong identity", "elasticsearch", "bot", "pass", "/prefix/_security/_authenticate", `{"username":"proxy"}`, "failed", "unknown", 200},
		{"es key ignored", "elasticsearch", "", "aWQ6c2VjcmV0", "/prefix/_security/_authenticate", `{"username":"anonymous","authentication_type":"anonymous"}`, "failed", "unknown", 200},
		{"es auth disabled", "elasticsearch", "bot", "pass", "/prefix/_security/_authenticate", `{}`, "failed", "unknown", 400},
		{"redirect", "elasticsearch", "bot", "pass", "/prefix/_security/_authenticate", `{}`, "failed", "unknown", 302},
		{"proxy html", "openobserve", "bot", "pass", "/prefix/api/default/streams", `<html>private</html>`, "failed", "unknown", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != tc.path {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				if tc.secret == "" {
					if r.Header.Get("Authorization") != "" {
						t.Error("connection test sent authentication")
					}
				} else if tc.user == "" {
					if r.Header.Get("Authorization") != "ApiKey "+tc.secret {
						t.Error("missing API key")
					}
				} else {
					u, p, ok := r.BasicAuth()
					if !ok || u != tc.user || p != tc.secret {
						t.Error("incorrect basic authentication")
					}
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			client := srv.Client()
			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			d := checkObservability(context.Background(), client, &HTTPConfig{BaseURL: srv.URL + "/prefix", DefaultOrganization: "default"}, tc.kind, tc.user, tc.secret, time.Now())
			if d.Status != tc.status || tc.auth != "" && d.Summary["authentication"] != tc.auth {
				t.Fatalf("unexpected diagnostic: %+v", d)
			}
			raw, _ := json.Marshal(d)
			if strings.Contains(string(raw), "private") || strings.Contains(string(raw), "aWQ6") {
				t.Fatal("diagnostic leaked private data")
			}
		})
	}
}
func TestObservabilityTLSAndCancellation(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	d := checkObservability(context.Background(), &http.Client{Timeout: 10 * time.Second}, &HTTPConfig{BaseURL: srv.URL}, "elasticsearch", "", "", time.Now())
	if d.Summary["reason"] != "tls_failed" {
		t.Fatalf("TLS not enforced: %+v", d)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	d = checkObservability(ctx, srv.Client(), &HTTPConfig{BaseURL: srv.URL}, "elasticsearch", "", "", time.Now())
	if d.Status != "failed" {
		t.Fatal("cancellation ignored")
	}
}
