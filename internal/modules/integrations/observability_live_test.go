//go:build integration_services

package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Run only against disposable service fixtures, never a user's cluster.
func TestLiveObservability(t *testing.T) {
	kind, address := os.Getenv("ANTCDP_TEST_SERVICE_KIND"), os.Getenv("ANTCDP_TEST_SERVICE_URL")
	if address == "" || (kind != "openobserve" && kind != "elasticsearch") {
		t.Skip("disposable service fixture not configured")
	}
	cfg := &HTTPConfig{BaseURL: address, DefaultOrganization: "default"}
	user, password := os.Getenv("ANTCDP_TEST_SERVICE_USER"), os.Getenv("ANTCDP_TEST_SERVICE_PASSWORD")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	d := probeObservability(ctx, cfg, kind, "", "", time.Now())
	if d.Summary["reachability"] != "reachable" {
		t.Fatalf("unreachable: %+v", d)
	}
	if user == "" {
		if d.Status != "succeeded" {
			t.Fatalf("anonymous probe failed: %+v", d)
		}
		return
	}
	d = probeObservability(ctx, cfg, kind, user, password, time.Now())
	if d.Status != "succeeded" {
		t.Fatalf("Basic verification failed: %+v", d)
	}
	d = probeObservability(ctx, cfg, kind, user, "deliberately-wrong-test-password", time.Now())
	if d.Status == "succeeded" {
		t.Fatal("invalid password accepted")
	}
	if kind == "elasticsearch" {
		// A temporary API key belongs only to this disposable fixture.
		tr := transport(cfg)
		defer tr.CloseIdleConnections()
		client := &http.Client{Transport: tr, Timeout: 10 * time.Second}
		req, err := http.NewRequestWithContext(ctx, "POST", address+"/_security/api_key", strings.NewReader(`{"name":"antcdp-fixture","expiration":"5m"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.SetBasicAuth(user, password)
		req.Header.Set("Content-Type", "application/json")
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = response.Body.Close() }()
		var key struct {
			Encoded string `json:"encoded"`
		}
		if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&key) != nil || key.Encoded == "" {
			t.Fatal("fixture API key creation failed")
		}
		d = probeObservability(ctx, cfg, kind, "", key.Encoded, time.Now())
		if d.Status != "succeeded" {
			t.Fatalf("API key verification failed: %+v", d)
		}
	}
}
