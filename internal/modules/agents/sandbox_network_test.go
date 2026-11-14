package agents

import (
	"errors"
	"slices"
	"testing"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestSandboxControlEndpointCannotBeAllowedByAgent(t *testing.T) {
	svc := CloudService{EndpointTargets: func(host string) ([]string, error) {
		if host != "control.example" {
			t.Fatalf("unexpected resolver target %q", host)
		}
		return []string{"192.0.2.7", "2001:db8::7", "192.0.2.7"}, nil
	}}
	targets, err := svc.endpointProtection("https://CONTROL.example.:8080")
	if err != nil || !slices.Equal(targets, []string{"192.0.2.7", "2001:db8::7", "control.example"}) {
		t.Fatal(targets, err)
	}
	policy, err := sandboxcore.SnapshotPolicy(sandboxcore.NetworkPolicy{DefaultAction: "allow", AllowTargets: []string{"192.0.2.7", "2001:db8::7", "control.example"}})
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := sandboxcore.CompilePolicy(policy, targets)
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range targets {
		found := false
		for _, rule := range compiled.ProviderPolicy.Egress {
			if rule.Target == target && rule.Action == "deny" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("control target %s lost mandatory deny", target)
		}
	}
	svc.EndpointTargets = func(string) ([]string, error) { return nil, errors.New("unavailable resolver") }
	if _, err = svc.endpointProtection("https://control.example"); err == nil {
		t.Fatal("failed resolution silently removed control protection")
	}
	if result, err := svc.endpointProtection("http://192.0.2.8:8080"); err != nil || !slices.Equal(result, []string{"192.0.2.8"}) {
		t.Fatal("literal endpoint unexpectedly resolved DNS", result, err)
	}
}
