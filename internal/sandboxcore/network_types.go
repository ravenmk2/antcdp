package sandboxcore

type NetworkPolicy struct {
	DefaultAction string   `json:"default_action"`
	PresetIDs     []string `json:"preset_ids"`
	AllowTargets  []string `json:"allow_targets"`
	DenyTargets   []string `json:"deny_targets"`
}

type ResolvedPreset struct {
	ID            string   `json:"id"`
	Action        string   `json:"action"`
	Targets       []string `json:"targets"`
	ContentSHA256 string   `json:"content_sha256"`
}

type NetworkPreset struct {
	ResolvedPreset
	Name        string `json:"name"`
	Description string `json:"description"`
}

type NetworkPolicySnapshot struct {
	NetworkPolicy
	ResolvedPresets []ResolvedPreset `json:"resolved_presets"`
	PolicySHA256    string           `json:"policy_sha256"`
}

type NetworkRule struct {
	Action string `json:"action"`
	Target string `json:"target"`
}

type ProviderNetworkPolicy struct {
	DefaultAction string        `json:"defaultAction"`
	Egress        []NetworkRule `json:"egress"`
}

type NetworkCompilation struct {
	CompilerVersion      string                `json:"compiler_version"`
	PolicySHA256         string                `json:"policy_sha256"`
	ProviderPolicySHA256 string                `json:"provider_policy_sha256"`
	ProviderPolicy       ProviderNetworkPolicy `json:"provider_policy"`
}
