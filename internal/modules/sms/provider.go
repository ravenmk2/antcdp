package sms

import (
	"context"
	"sort"
)

// Provider adapts an SMS account and a normalized template to its wire protocol.
// Registrations are application code, never user-supplied executables or URLs.
type Provider interface {
	Send(context.Context, Profile, Authentication, string, Content) SendLog
}

type ProviderInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	TemplateMode string `json:"template_mode"`
}

type providerRegistration struct {
	Info    ProviderInfo
	Adapter Provider
}
type aliyunProvider struct{}

func (aliyunProvider) Send(ctx context.Context, p Profile, a Authentication, to string, content Content) SendLog {
	return sendAliyun(ctx, p, a, to, content)
}

var providers = map[string]providerRegistration{
	"aliyun_sms": {ProviderInfo{"aliyun_sms", "阿里云国内短信", "remote"}, aliyunProvider{}},
}

func ProviderCatalog() []ProviderInfo {
	items := make([]ProviderInfo, 0, len(providers))
	for _, provider := range providers {
		items = append(items, provider.Info)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}
