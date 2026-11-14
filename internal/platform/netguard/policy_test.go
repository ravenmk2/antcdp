package netguard

import (
	"context"
	"errors"
	"net/netip"
	"testing"
)

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (f resolverFunc) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return f(ctx, network, host)
}

func TestTargetsRequireExactInternalExceptionAndNeverAllowMetadata(t *testing.T) {
	for _, tc := range []struct {
		target             string
		allow              []string
		internal, accepted bool
	}{
		{"https://93.184.216.34/page", nil, false, true},
		{"http://10.20.30.40/page", nil, false, false},
		{"http://10.20.30.40/page", []string{"10.20.30.40"}, true, true},
		{"http://127.0.0.1/", []string{"127.0.0.1"}, false, false},
		{"http://169.254.169.254/latest", []string{"169.254.169.254"}, false, false},
		{"http://100.100.100.200/latest", []string{"100.100.100.200"}, false, false},
		{"http://[::ffff:127.0.0.1]/", []string{"127.0.0.1"}, false, false},
		{"http://[fd00:ec2::254]/", []string{"fd00:ec2::254"}, false, false},
		{"http://[64:ff9b::a00:1]/", nil, false, false},
		{"https://user:secret@example.com/", nil, false, false},
		{"http://example.com:99999/", nil, false, false},
		{"file:///etc/passwd", nil, false, false},
	} {
		t.Run(tc.target, func(t *testing.T) {
			got, err := (Policy{AllowedInternalHosts: tc.allow}).Classify(t.Context(), tc.target)
			if (err == nil) != tc.accepted || err == nil && got != tc.internal {
				t.Fatalf("internal=%v err=%v", got, err)
			}
		})
	}
}

func TestDNSAnswersAndRebindingAreValidatedAtActualDial(t *testing.T) {
	calls := 0
	resolver := resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		calls++
		if calls == 1 {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	})
	policy := Policy{Resolver: resolver}
	if _, err := policy.Classify(t.Context(), "https://public.example/page"); err != nil {
		t.Fatal(err)
	}
	transport := policy.Transport()
	defer transport.CloseIdleConnections()
	if transport.Proxy != nil {
		t.Fatal("environment proxy bypasses pinned DNS")
	}
	_, err := transport.DialContext(t.Context(), "tcp", "public.example:443")
	if !errors.Is(err, ErrTarget) || calls != 2 {
		t.Fatalf("rebind accepted err=%v calls=%d", err, calls)
	}
	policy.Resolver = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("10.0.0.1")}, nil
	})
	if _, err = policy.Classify(t.Context(), "https://mixed.example/"); !errors.Is(err, ErrTarget) {
		t.Fatal("mixed public/private DNS accepted", err)
	}
}

func TestInternalHostExceptionsAreCanonicalAndNotSuffixGrants(t *testing.T) {
	policy := Policy{AllowedInternalHosts: []string{"INTERNAL.EXAMPLE."}, Resolver: resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("10.0.0.4")}, nil
	})}
	if internal, err := policy.Classify(t.Context(), "https://internal.example/"); err != nil || !internal {
		t.Fatal(internal, err)
	}
	if _, err := policy.Classify(t.Context(), "https://other.internal.example/"); !errors.Is(err, ErrTarget) {
		t.Fatal("suffix grant accepted", err)
	}
	policy.ProtectedHosts = []string{"internal.example"}
	if _, err := policy.Classify(t.Context(), "https://INTERNAL.EXAMPLE./"); !errors.Is(err, ErrTarget) {
		t.Fatal("protected host bypassed", err)
	}
}
