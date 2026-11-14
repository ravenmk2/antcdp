package sandboxcore

import (
	"errors"
	"fmt"
	"net/netip"
	"reflect"
	"testing"
)

func TestNetworkTargetNormalization(t *testing.T) {
	for _, tt := range []struct{ input, want, code string }{
		{" EXAMPLE.COM. ", "example.com", ""}, {"*.EXAMPLE.COM", "*.example.com", ""},
		{"::ffff:10.1.2.3", "10.1.2.3", ""}, {"::ffff:10.0.0.0/104", "10.0.0.0/8", ""},
		{"2001:0db8::/32", "2001:db8::/32", ""}, {"10.0.0.1/32", "10.0.0.1", ""},
		{"xn--fsqu00a.example", "xn--fsqu00a.example", ""},
		{"10.1.1.1/8", "", "NETWORK_TARGET_INVALID"}, {"::ffff:0.0.0.0/96", "", "NETWORK_TARGET_INVALID"},
		{"0.0.0.0/0", "", "NETWORK_TARGET_INVALID"}, {"::/0", "", "NETWORK_TARGET_INVALID"},
		{"127.1.0.0/16", "", "NETWORK_TARGET_UNSUPPORTED"}, {"::ffff:127.0.0.1", "", "NETWORK_TARGET_UNSUPPORTED"},
		{"::1/128", "", "NETWORK_TARGET_UNSUPPORTED"}, {"126.0.0.0/7", "126.0.0.0/7", ""},
		{"localhost", "", "NETWORK_TARGET_INVALID"}, {"例子.example", "", "NETWORK_TARGET_INVALID"},
		{"https://example.com", "", "NETWORK_TARGET_INVALID"}, {"example.com:443", "", "NETWORK_TARGET_INVALID"},
		{"foo.*.example", "", "NETWORK_TARGET_INVALID"}, {"example.com..", "", "NETWORK_TARGET_INVALID"},
		{"fe80::1%eth0", "", "NETWORK_TARGET_INVALID"},
	} {
		t.Run(tt.input, func(t *testing.T) {
			got, err := normalizeTarget(tt.input, false)
			var detail *Error
			if tt.code == "" {
				if err != nil || got != tt.want {
					t.Fatalf("got %q/%v, want %q", got, err, tt.want)
				}
			} else if !errors.As(err, &detail) || detail.Code != tt.code {
				t.Fatalf("got %v, want %s", err, tt.code)
			}
		})
	}
}

func TestSnapshotCanonicalAndImmutable(t *testing.T) {
	p := DefaultPolicy()
	p.AllowTargets = []string{"EXAMPLE.COM.", "10.1.0.0/16", "example.com"}
	a, err := SnapshotPolicy(p)
	if err != nil {
		t.Fatal(err)
	}
	p.AllowTargets = []string{"10.1.0.0/16", "example.com"}
	p.PresetIDs[0], p.PresetIDs[3] = p.PresetIDs[3], p.PresetIDs[0]
	b, err := SnapshotPolicy(p)
	if err != nil || !reflect.DeepEqual(a, b) {
		t.Fatalf("canonical mismatch: %v", err)
	}
	// A stored version has its own validated expansion, independent of the live
	// catalog. Public callers cannot submit snapshots.
	a.PresetIDs[0] = "frozen_previous_v1"
	a.ResolvedPresets[0].ID = a.PresetIDs[0]
	a.ResolvedPresets[0].ContentSHA256 = presetHash(a.ResolvedPresets[0])
	a.PolicySHA256 = policyHash(a)
	if _, err = CompilePolicy(a, nil); err != nil {
		t.Fatal(err)
	}
	a.ResolvedPresets[0].Targets[0] = "198.51.100.0/24"
	if err = ValidateSnapshot(a); err == nil {
		t.Fatal("tampered expansion accepted")
	}
}

func TestNetworkCompilationPriorityAndLayers(t *testing.T) {
	p := DefaultPolicy()
	p.AllowTargets = []string{"10.1.0.0/16", "fc00:1::/32", "*.example.com", "service.internal"}
	p.DenyTargets = []string{"10.1.2.0/24", "fc00:1:2::/48", "bad.example.com"}
	s, err := SnapshotPolicy(p)
	if err != nil {
		t.Fatal(err)
	}
	c, err := CompilePolicy(s, []string{"10.1.3.0/24", "protected.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		ip   string
		deny bool
	}{
		{"10.2.1.1", true}, {"10.1.1.1", false}, {"10.1.2.1", true}, {"10.1.3.1", true},
		{"192.168.1.1", true}, {"fc00:1:1::1", false}, {"fc00:1:2::1", true}, {"fc00:2::1", true},
	} {
		denied := false
		for _, rule := range c.ProviderPolicy.Egress {
			prefix, ok := addressPrefix(rule.Target)
			if ok && rule.Action == "deny" && prefix.Contains(netip.MustParseAddr(tt.ip)) {
				denied = true
			}
		}
		if denied != tt.deny {
			t.Errorf("%s deny=%v", tt.ip, denied)
		}
	}
	seenAllow := false
	for _, rule := range c.ProviderPolicy.Egress {
		if rule.Action == "allow" {
			seenAllow = true
		}
		if rule.Action == "deny" && seenAllow {
			t.Fatal("deny follows allow")
		}
	}
	if err := ValidateCompilation(c, s); err != nil {
		t.Fatal(err)
	}
	c.ProviderPolicy.DefaultAction = "deny"
	if err := ValidateCompilation(c, s); err == nil {
		t.Fatal("tampered compilation accepted")
	}
}

func TestDefaultDenyDoesNotOpenDNSForIPAllow(t *testing.T) {
	p := NetworkPolicy{DefaultAction: "deny", AllowTargets: []string{"198.51.100.1"}}
	s, err := SnapshotPolicy(p)
	if err != nil {
		t.Fatal(err)
	}
	c, err := CompilePolicy(s, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.ProviderPolicy.DefaultAction != "deny" || len(c.ProviderPolicy.Egress) != 1 || c.ProviderPolicy.Egress[0].Target != "198.51.100.1" {
		t.Fatalf("unexpected expansion: %+v", c)
	}
}

func TestNetworkDifferenceComplexityLimit(t *testing.T) {
	p := DefaultPolicy()
	for i := range 100 {
		p.AllowTargets = append(p.AllowTargets, fmt.Sprintf("fc%02x:%x:1234:5678:9abc:def0:1234:5678", i, i*193))
	}
	s, err := SnapshotPolicy(p)
	if err != nil {
		t.Fatal(err)
	}
	_, err = CompilePolicy(s, nil)
	var detail *Error
	if !errors.As(err, &detail) || detail.Code != "NETWORK_POLICY_TOO_COMPLEX" {
		t.Fatalf("want complexity rejection, got %v", err)
	}
}

func TestPrefixDifferenceExactCoverage(t *testing.T) {
	base := netip.MustParsePrefix("198.51.100.0/24")
	remove := []netip.Prefix{netip.MustParsePrefix("198.51.100.32/27"), netip.MustParsePrefix("198.51.100.67/32"), netip.MustParsePrefix("198.51.100.128/25")}
	got, err := subtractPrefixes([]netip.Prefix{base}, remove)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 256 {
		addr := netip.AddrFrom4([4]byte{198, 51, 100, byte(i)})
		want, actual := true, false
		for _, p := range remove {
			if p.Contains(addr) {
				want = false
			}
		}
		for _, p := range got {
			if p.Contains(addr) {
				actual = true
			}
		}
		if actual != want {
			t.Fatalf("coverage mismatch at %s", addr)
		}
	}
}
