// Package netguard validates and pins outbound addresses for controlled readers.
package netguard

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/idna"
)

var ErrTarget = errors.New("outbound target not allowed")
var ErrResolve = errors.New("outbound target resolution failed")

type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type Policy struct {
	AllowedInternalHosts []string
	ProtectedHosts       []string
	Resolver             Resolver
}

func ParseURL(raw string) (*url.URL, error) {
	if len(raw) == 0 || len(raw) > 8192 || strings.ContainsAny(raw, "\r\n\x00\\") {
		return nil, ErrTarget
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return nil, ErrTarget
	}
	if strings.Contains(u.Hostname(), "%") {
		return nil, ErrTarget
	}
	if value := u.Port(); value != "" {
		port, e := strconv.Atoi(value)
		if e != nil || port < 1 || port > 65535 {
			return nil, ErrTarget
		}
	}
	if _, err = NormalizeHost(u.Hostname()); err != nil {
		return nil, err
	}
	return u, nil
}

func NormalizeHost(host string) (string, error) {
	if host == "" || len(host) > 253 || strings.ContainsAny(host, "/\\@?#%*\r\n\x00 \t") {
		return "", ErrTarget
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Unmap().String(), nil
	}
	if strings.Contains(host, ":") {
		return "", ErrTarget
	}
	value, err := idna.Lookup.ToASCII(host)
	if err != nil || value == "" || len(value) > 253 {
		return "", ErrTarget
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) == 0 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", ErrTarget
		}
	}
	return value, nil
}

var prohibited = prefixes(
	"0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24",
	"198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
	"100.100.100.200/32", "168.63.129.16/32", "::/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64",
	"2001:db8::/32", "2002::/16", "fe80::/10", "ff00::/8", "fd00:ec2::254/128",
)
var sharedAddress = netip.MustParsePrefix("100.64.0.0/10")

func prefixes(values ...string) []netip.Prefix {
	result := make([]netip.Prefix, 0, len(values))
	for _, v := range values {
		result = append(result, netip.MustParsePrefix(v))
	}
	return result
}

func addressClass(ip netip.Addr) (internal, allowed bool) {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false, false
	}
	for _, prefix := range prohibited {
		if prefix.Contains(ip) {
			return false, false
		}
	}
	return ip.IsPrivate() || sharedAddress.Contains(ip), true
}

func containsHost(host string, values []string) bool {
	for _, value := range values {
		if normalized, err := NormalizeHost(value); err == nil && normalized == host {
			return true
		}
	}
	return false
}

func (p Policy) lookup(ctx context.Context, host string) ([]netip.Addr, bool, error) {
	host, err := NormalizeHost(host)
	if err != nil || containsHost(host, p.ProtectedHosts) {
		return nil, false, ErrTarget
	}
	var addresses []netip.Addr
	if ip, e := netip.ParseAddr(host); e == nil {
		addresses = []netip.Addr{ip}
	} else {
		resolver := p.Resolver
		if resolver == nil {
			resolver = net.DefaultResolver
		}
		addresses, err = resolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(addresses) == 0 {
			if ctx.Err() != nil {
				return nil, false, ctx.Err()
			}
			return nil, false, ErrResolve
		}
	}
	internal := false
	for _, ip := range addresses {
		private, allowed := addressClass(ip)
		if !allowed || private && !containsHost(host, p.AllowedInternalHosts) {
			return nil, false, ErrTarget
		}
		internal = internal || private
	}
	return addresses, internal, nil
}

func (p Policy) Classify(ctx context.Context, raw string) (bool, error) {
	u, err := ParseURL(raw)
	if err != nil {
		return false, err
	}
	_, internal, err := p.lookup(ctx, u.Hostname())
	return internal, err
}

func (p Policy) Transport() *http.Transport {
	return &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, DisableKeepAlives: true, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 20 * time.Second, MaxResponseHeaderBytes: 32 << 10,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, ErrTarget
			}
			ips, _, err := p.lookup(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				conn, dialErr := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
				if dialErr != nil {
					if ctx.Err() != nil {
						return nil, ctx.Err()
					}
					continue
				}
				actual, ok := conn.RemoteAddr().(*net.TCPAddr)
				if !ok || actual.AddrPort().Addr().Unmap() != ip.Unmap() {
					_ = conn.Close()
					return nil, ErrTarget
				}
				return conn, nil
			}
			return nil, ErrResolve
		},
	}
}
