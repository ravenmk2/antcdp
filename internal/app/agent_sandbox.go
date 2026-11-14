package app

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

// The protected hosts are deployment facts, never model or browser input.
// Resolve addresses as well as names before compiling a fresh instance policy.
func agentSandboxProtectedTargets(installer *install.Service) ([]string, error) {
	hosts, err := installer.OutboundProtectedHosts()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out := []string{}
	for _, host := range hosts {
		if host == "" {
			return nil, errors.New("sandbox protection host unavailable")
		}
		if addr, e := netip.ParseAddr(host); e == nil {
			out = append(out, addr.Unmap().String())
			continue
		}
		addresses, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if e != nil || len(addresses) == 0 {
			return nil, errors.New("sandbox protection address unavailable")
		}
		for _, address := range addresses {
			out = append(out, address.Unmap().String())
		}
		if strings.Contains(host, ".") {
			out = append(out, strings.ToLower(strings.TrimSuffix(host, ".")))
		}
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}
