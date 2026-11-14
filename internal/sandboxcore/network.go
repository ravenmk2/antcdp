package sandboxcore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/netip"
	"slices"
	"sort"
	"strings"
)

const (
	NetworkCompilerVersion = "opensandbox-egress-v1"
	MaxNetworkRules        = 4096
	MaxNetworkPolicyBytes  = 256 << 10
)

// Presets returns fresh copies. IDs version immutable address semantics, not UI
// names. A previously stored snapshot never needs this live catalog to compile.
func Presets() []NetworkPreset {
	items := []NetworkPreset{
		{ResolvedPreset: ResolvedPreset{ID: "private_ipv4_v1", Action: "deny", Targets: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}}, Name: "私有IPv4", Description: "私有IPv4地址范围"},
		{ResolvedPreset: ResolvedPreset{ID: "private_ipv6_v1", Action: "deny", Targets: []string{"fc00::/7"}}, Name: "IPv6内网", Description: "IPv6唯一本地地址范围"},
		{ResolvedPreset: ResolvedPreset{ID: "link_local_v1", Action: "deny", Targets: []string{"169.254.0.0/16", "fe80::/10"}}, Name: "链路本地", Description: "IPv4与IPv6链路本地地址范围"},
		{ResolvedPreset: ResolvedPreset{ID: "shared_ipv4_v1", Action: "deny", Targets: []string{"100.64.0.0/10"}}, Name: "共享IPv4（运营商/VPN常用）", Description: "共享IPv4地址范围"},
	}
	for i := range items {
		slices.Sort(items[i].Targets)
		items[i].ContentSHA256 = presetHash(items[i].ResolvedPreset)
	}
	return items
}

func PresetCatalogVersion() string { return digest(Presets()) }

func DefaultPolicy() NetworkPolicy {
	return NetworkPolicy{DefaultAction: "allow", PresetIDs: []string{"link_local_v1", "private_ipv4_v1", "private_ipv6_v1", "shared_ipv4_v1"}, AllowTargets: []string{}, DenyTargets: []string{}}
}

func NormalizePolicy(p NetworkPolicy) (NetworkPolicy, error) {
	if p.DefaultAction != "allow" && p.DefaultAction != "deny" || len(p.PresetIDs) > 4 || len(p.AllowTargets) > 100 || len(p.DenyTargets) > 100 {
		return NetworkPolicy{}, &Error{Code: "NETWORK_POLICY_INVALID"}
	}
	known := map[string]bool{}
	for _, preset := range Presets() {
		known[preset.ID] = true
	}
	ids := append([]string{}, p.PresetIDs...)
	slices.Sort(ids)
	for i, id := range ids {
		if !known[id] || i > 0 && ids[i-1] == id {
			return NetworkPolicy{}, &Error{Code: "NETWORK_POLICY_INVALID"}
		}
	}
	allow, err := normalizeTargets(p.AllowTargets, false)
	if err != nil {
		return NetworkPolicy{}, err
	}
	deny, err := normalizeTargets(p.DenyTargets, false)
	if err != nil {
		return NetworkPolicy{}, err
	}
	return NetworkPolicy{DefaultAction: p.DefaultAction, PresetIDs: ids, AllowTargets: allow, DenyTargets: deny}, nil
}

func SnapshotPolicy(p NetworkPolicy) (NetworkPolicySnapshot, error) {
	normal, err := NormalizePolicy(p)
	if err != nil {
		return NetworkPolicySnapshot{}, err
	}
	out := NetworkPolicySnapshot{NetworkPolicy: normal, ResolvedPresets: []ResolvedPreset{}}
	for _, id := range normal.PresetIDs {
		for _, preset := range Presets() {
			if preset.ID == id {
				out.ResolvedPresets = append(out.ResolvedPresets, preset.ResolvedPreset)
			}
		}
	}
	out.PolicySHA256 = policyHash(out)
	return out, nil
}

// ValidateSnapshot checks persisted, normalized facts and hashes without
// looking up the current preset contents. Snapshot input is not a public write
// DTO: the host must only load it from trusted persisted configuration.
func ValidateSnapshot(s NetworkPolicySnapshot) error {
	if s.DefaultAction != "allow" && s.DefaultAction != "deny" || len(s.PresetIDs) > 4 || len(s.AllowTargets) > 100 || len(s.DenyTargets) > 100 || len(s.ResolvedPresets) != len(s.PresetIDs) {
		return &Error{Code: "NETWORK_SNAPSHOT_INVALID"}
	}
	for _, targets := range [][]string{s.AllowTargets, s.DenyTargets} {
		normal, err := normalizeTargets(targets, false)
		if err != nil || !slices.Equal(normal, targets) {
			return &Error{Code: "NETWORK_SNAPSHOT_INVALID"}
		}
	}
	for i, p := range s.ResolvedPresets {
		if p.ID == "" || p.ID != s.PresetIDs[i] || i > 0 && s.PresetIDs[i-1] >= p.ID || p.Action != "deny" || len(p.Targets) == 0 || len(p.Targets) > MaxNetworkRules {
			return &Error{Code: "NETWORK_SNAPSHOT_INVALID"}
		}
		normal, err := normalizeTargets(p.Targets, false)
		if err != nil || !slices.Equal(normal, p.Targets) || p.ContentSHA256 != presetHash(p) {
			return &Error{Code: "NETWORK_SNAPSHOT_INVALID"}
		}
		for _, target := range p.Targets {
			if _, ok := addressPrefix(target); !ok {
				return &Error{Code: "NETWORK_SNAPSHOT_INVALID"}
			}
		}
	}
	if s.PolicySHA256 != policyHash(s) {
		return &Error{Code: "NETWORK_SNAPSHOT_INVALID"}
	}
	return nil
}

func normalizeTargets(targets []string, deployment bool) ([]string, error) {
	out := make([]string, 0, len(targets))
	for _, target := range targets {
		value, err := normalizeTarget(target, deployment)
		if err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}

func normalizeTarget(target string, deployment bool) (string, error) {
	target = strings.TrimSpace(target)
	invalid := &Error{Code: "NETWORK_TARGET_INVALID"}
	if len(target) == 0 || len(target) > 253 || strings.ContainsAny(target, "%\\@?#") {
		return "", invalid
	}
	for _, c := range target {
		if c > 127 || c <= 32 {
			return "", invalid
		}
	}
	if prefix, err := netip.ParsePrefix(target); err == nil {
		if prefix != prefix.Masked() {
			return "", invalid
		}
		if prefix.Addr().Is4In6() {
			if prefix.Bits() < 96 {
				return "", invalid
			}
			prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
		}
		if prefix.Bits() == 0 {
			return "", invalid
		}
		if !deployment && loopbackOnly(prefix) {
			return "", &Error{Code: "NETWORK_TARGET_UNSUPPORTED"}
		}
		if prefix.Bits() == prefix.Addr().BitLen() {
			return prefix.Addr().String(), nil
		}
		return prefix.String(), nil
	}
	if addr, err := netip.ParseAddr(target); err == nil {
		addr = addr.Unmap()
		if !deployment && addr.IsLoopback() {
			return "", &Error{Code: "NETWORK_TARGET_UNSUPPORTED"}
		}
		return addr.String(), nil
	}
	target = strings.ToLower(strings.TrimSuffix(target, "."))
	domain := strings.TrimPrefix(target, "*.")
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return "", invalid
	}
	for _, label := range labels {
		if len(label) < 1 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", invalid
		}
		for _, c := range label {
			valid := c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-'
			if !valid {
				return "", invalid
			}
		}
	}
	return target, nil
}

func loopbackOnly(p netip.Prefix) bool {
	if p.Addr().Is4() {
		return p.Bits() >= 8 && netip.MustParsePrefix("127.0.0.0/8").Contains(p.Addr())
	}
	return p.Bits() == 128 && p.Addr().IsLoopback()
}

func addressPrefix(target string) (netip.Prefix, bool) {
	if p, err := netip.ParsePrefix(target); err == nil {
		return p, true
	}
	if a, err := netip.ParseAddr(target); err == nil {
		return netip.PrefixFrom(a, a.BitLen()), true
	}
	return netip.Prefix{}, false
}

func digest(v any) string {
	b, _ := json.Marshal(v) // all callers use fixed structs containing JSON-safe values
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func presetHash(p ResolvedPreset) string {
	return digest(struct {
		ID      string   `json:"id"`
		Action  string   `json:"action"`
		Targets []string `json:"targets"`
	}{p.ID, p.Action, p.Targets})
}

func policyHash(s NetworkPolicySnapshot) string {
	return digest(struct {
		Version string `json:"version"`
		NetworkPolicy
		Presets []ResolvedPreset `json:"resolved_presets"`
	}{"1", s.NetworkPolicy, s.ResolvedPresets})
}

func sortPrefixes(items []netip.Prefix) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Bits() != items[j].Bits() {
			return items[i].Bits() < items[j].Bits()
		}
		return items[i].Addr().Less(items[j].Addr())
	})
}
