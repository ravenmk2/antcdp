package agents

import (
	"context"
	"net"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// The control-plane hostname and its resolved addresses are deployment denies,
// never ordinary user policy. They are frozen into the create intent. This is
// defense in depth; host firewalls still protect DNS changes and local services.
func (s *CloudService) endpointProtection(endpoint string) ([]string, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" {
		return nil, httpx.E(409, "SANDBOX_CONFIG_INVALID", "沙箱控制面地址无效")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if address, err := netip.ParseAddr(host); err == nil {
		if address.Zone() != "" || address.IsUnspecified() || address.IsMulticast() {
			return nil, httpx.E(409, "SANDBOX_PROTECTION_UNAVAILABLE", "沙箱控制面保护地址无效")
		}
		return []string{address.Unmap().String()}, nil
	}
	resolve := s.EndpointTargets
	if resolve == nil {
		resolve = resolveSandboxEndpoint
	}
	addresses, err := resolve(host)
	if err != nil || len(addresses) == 0 {
		return nil, httpx.E(409, "SANDBOX_PROTECTION_UNAVAILABLE", "无法核实沙箱控制面保护地址")
	}
	protected := make([]string, 0, len(addresses)+1)
	for _, value := range addresses {
		address, err := netip.ParseAddr(value)
		if err != nil || address.Zone() != "" || address.IsUnspecified() || address.IsMulticast() {
			return nil, httpx.E(409, "SANDBOX_PROTECTION_UNAVAILABLE", "沙箱控制面保护地址无效")
		}
		protected = append(protected, address.Unmap().String())
	}
	// OpenSandbox's DNS policy accepts multi-label names. A Docker-local
	// single-label control name is protected by its resolved IP addresses.
	if strings.Contains(host, ".") {
		protected = append(protected, host)
	}
	slices.Sort(protected)
	return slices.Compact(protected), nil
}

func resolveSandboxEndpoint(host string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(addresses))
	for _, address := range addresses {
		result = append(result, address.Unmap().String())
	}
	return result, nil
}
