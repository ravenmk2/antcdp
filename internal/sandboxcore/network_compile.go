package sandboxcore

import (
	"encoding/json"
	"net/netip"
	"slices"
)

// CompilePolicy preserves the provider's separate DNS and address checks.
// Deployment denies can never be removed by custom allows. Only preset address
// denies are subtracted; a domain allow does not exempt any denied IP address.
func CompilePolicy(snapshot NetworkPolicySnapshot, protectedTargets []string) (NetworkCompilation, error) {
	if err := ValidateSnapshot(snapshot); err != nil {
		return NetworkCompilation{}, err
	}
	if len(protectedTargets) > MaxNetworkRules {
		return NetworkCompilation{}, &Error{Code: "NETWORK_POLICY_TOO_COMPLEX"}
	}
	protected, err := normalizeTargets(protectedTargets, true)
	if err != nil {
		return NetworkCompilation{}, err
	}
	allowIPs, allowNames := splitTargets(snapshot.AllowTargets)
	denyIPs, denyNames := splitTargets(append(protected, snapshot.DenyTargets...))
	presetIPs := []netip.Prefix{}
	for _, preset := range snapshot.ResolvedPresets {
		for _, target := range preset.Targets {
			prefix, _ := addressPrefix(target)
			presetIPs = append(presetIPs, prefix)
		}
	}
	presetIPs, err = subtractPrefixes(minimalPrefixes(presetIPs), minimalPrefixes(allowIPs))
	if err != nil {
		return NetworkCompilation{}, err
	}
	denyIPs = minimalPrefixes(append(denyIPs, presetIPs...))
	allowIPs = minimalPrefixes(allowIPs)
	out := ProviderNetworkPolicy{DefaultAction: snapshot.DefaultAction, Egress: []NetworkRule{}}
	// Deny-before-allow also makes overlapping exact/wildcard DNS rules safe.
	// nftables enforces IP deny precedence independently of this array order.
	for _, target := range sortedUnique(denyNames) {
		out.Egress = append(out.Egress, NetworkRule{Action: "deny", Target: target})
	}
	for _, prefix := range denyIPs {
		out.Egress = append(out.Egress, NetworkRule{Action: "deny", Target: prefixTarget(prefix)})
	}
	for _, target := range sortedUnique(allowNames) {
		out.Egress = append(out.Egress, NetworkRule{Action: "allow", Target: target})
	}
	for _, prefix := range allowIPs {
		out.Egress = append(out.Egress, NetworkRule{Action: "allow", Target: prefixTarget(prefix)})
	}
	if len(out.Egress) > MaxNetworkRules {
		return NetworkCompilation{}, &Error{Code: "NETWORK_POLICY_TOO_COMPLEX"}
	}
	encoded, _ := json.Marshal(out)
	if len(encoded) > MaxNetworkPolicyBytes {
		return NetworkCompilation{}, &Error{Code: "NETWORK_POLICY_TOO_COMPLEX"}
	}
	return NetworkCompilation{CompilerVersion: NetworkCompilerVersion, PolicySHA256: snapshot.PolicySHA256, ProviderPolicySHA256: digest(out), ProviderPolicy: out}, nil
}

func ValidateCompilation(c NetworkCompilation, snapshot NetworkPolicySnapshot) error {
	if err := ValidateSnapshot(snapshot); err != nil {
		return err
	}
	if c.CompilerVersion != NetworkCompilerVersion || c.PolicySHA256 != snapshot.PolicySHA256 || c.ProviderPolicySHA256 != digest(c.ProviderPolicy) || c.ProviderPolicy.DefaultAction != snapshot.DefaultAction {
		return &Error{Code: "NETWORK_COMPILATION_INVALID"}
	}
	encoded, _ := json.Marshal(c.ProviderPolicy)
	if len(c.ProviderPolicy.Egress) > MaxNetworkRules || len(encoded) > MaxNetworkPolicyBytes {
		return &Error{Code: "NETWORK_POLICY_TOO_COMPLEX"}
	}
	for _, r := range c.ProviderPolicy.Egress {
		target, err := normalizeTarget(r.Target, true)
		if err != nil || target != r.Target || r.Action != "allow" && r.Action != "deny" {
			return &Error{Code: "NETWORK_COMPILATION_INVALID"}
		}
	}
	return nil
}

func splitTargets(targets []string) ([]netip.Prefix, []string) {
	ips := []netip.Prefix{}
	names := []string{}
	for _, target := range targets {
		if p, ok := addressPrefix(target); ok {
			ips = append(ips, p)
		} else {
			names = append(names, target)
		}
	}
	return ips, names
}

func prefixTarget(p netip.Prefix) string {
	if p.Bits() == p.Addr().BitLen() {
		return p.Addr().String()
	}
	return p.String()
}

func sortedUnique(items []string) []string {
	slices.Sort(items)
	return slices.Compact(items)
}

func minimalPrefixes(items []netip.Prefix) []netip.Prefix {
	sortPrefixes(items)
	out := []netip.Prefix{}
	for _, p := range items {
		covered := false
		for _, prior := range out {
			if prior.Contains(p.Addr()) && prior.Bits() <= p.Bits() {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, p)
		}
	}
	return out
}

func subtractPrefixes(base, removed []netip.Prefix) ([]netip.Prefix, error) {
	for _, remove := range removed {
		next := []netip.Prefix{}
		for _, p := range base {
			var err error
			next, err = subtractOne(next, p, remove)
			if err != nil {
				return nil, err
			}
		}
		base = next
	}
	return minimalPrefixes(base), nil
}

func subtractOne(out []netip.Prefix, base, remove netip.Prefix) ([]netip.Prefix, error) {
	if !base.Overlaps(remove) {
		out = append(out, base)
	} else if !remove.Contains(base.Addr()) || remove.Bits() > base.Bits() {
		left, right := splitPrefix(base)
		var err error
		out, err = subtractOne(out, left, remove)
		if err != nil {
			return nil, err
		}
		return subtractOne(out, right, remove)
	}
	if len(out) > MaxNetworkRules {
		return nil, &Error{Code: "NETWORK_POLICY_TOO_COMPLEX"}
	}
	return out, nil
}

func splitPrefix(p netip.Prefix) (netip.Prefix, netip.Prefix) {
	bit := p.Bits()
	addr := p.Addr()
	left := netip.PrefixFrom(addr, bit+1)
	if addr.Is4() {
		bytes := addr.As4()
		bytes[bit/8] |= 1 << (7 - bit%8)
		return left, netip.PrefixFrom(netip.AddrFrom4(bytes), bit+1)
	}
	bytes := addr.As16()
	bytes[bit/8] |= 1 << (7 - bit%8)
	return left, netip.PrefixFrom(netip.AddrFrom16(bytes), bit+1)
}
