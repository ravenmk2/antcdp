package models

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func testingBusy() error {
	return httpx.E(409, "MODEL_TEST_IN_PROGRESS", "此提供商正在测试，请等待完成或停止测试")
}
func (s *Service) isTesting(id uint64) bool { _, ok := s.active.Load(id); return ok }

func (s *Service) TestProvider(ctx context.Context, raw string, id uint64, tag string) (*Result, error) {
	return s.test(ctx, raw, id, tag, "provider_probe", nil)
}
func (s *Service) DiscoverModels(ctx context.Context, raw string, id uint64, tag string) (*Result, error) {
	return s.test(ctx, raw, id, tag, "model_discovery", nil)
}
func (s *Service) TestModel(ctx context.Context, raw string, id uint64, tag string, levels []string) (*Result, error) {
	return s.test(ctx, raw, id, tag, "model_probe", levels)
}

// Configuration and credentials are read in a short authorized transaction.
// The remote request is bounded by the caller and never holds a database lock.
func (s *Service) test(ctx context.Context, raw string, id uint64, tag, kind string, levels []string) (*Result, error) {
	var request ProbeRequest
	var claimed uint64
	defer func() {
		if claimed != 0 {
			s.active.Delete(claimed)
		}
	}()
	out, err := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		var p *Provider
		var d *Definition
		var e error
		if kind == "model_probe" {
			p, d, e = s.lockDefinition(r, id)
		} else {
			p, e = r.Provider(id)
			if e == nil {
				e = s.provider(p)
			}
		}
		if e != nil {
			return e
		}
		expected := s.tag("provider", p.ID, p.RowVersion)
		targetKind, targetID := "model_provider", p.ID
		if d != nil {
			expected = s.tag("definition", d.ID, d.RowVersion)
			targetKind, targetID = "model_definition", d.ID
		}
		if e = checkTag(tag, expected); e != nil {
			return e
		}
		if !p.Enabled || p.AuthMethod == "api_key" && !p.HasSecret || d != nil && !d.Enabled {
			return unavailable()
		}
		if kind == "model_probe" {
			if len(levels) < 1 || len(levels) > 4 {
				return httpx.Invalid("levels", "invalid_count")
			}
			seen := map[string]bool{}
			for _, level := range levels {
				if seen[level] || (level != "generation" && level != "tools" && level != "stream" && level != "thinking") {
					return httpx.Invalid("levels", "unsupported")
				}
				seen[level] = true
			}
		}
		if s.Probe == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "模型测试暂不可用")
		}
		if _, busy := s.active.LoadOrStore(p.ID, true); busy {
			return testingBusy()
		}
		claimed = p.ID
		request = ProbeRequest{Kind: kind, Provider: *p, Model: d, Levels: levels}
		if p.AuthMethod == "api_key" {
			secret, e := r.Secret(p.ID)
			if e != nil {
				return e
			}
			if s.Cipher == nil {
				return unavailable()
			}
			request.Secret, e = s.Cipher(fmt.Sprintf("models/provider/%d/authentication", p.ID), secret, false)
			if e != nil {
				return httpx.E(503, "CREDENTIAL_UNAVAILABLE", "无法读取认证信息，请重新配置")
			}
		}
		action := "model_provider.probe"
		if kind == "model_probe" {
			action = "model_definition.probe"
		}
		if kind == "model_discovery" {
			action = "model_provider.discovery"
		}
		return audit(ctx, tx, a, action, targetKind, targetID)
	})
	if err != nil {
		return out, err
	}
	duration := 30 * time.Second
	if kind == "model_probe" {
		duration = 120 * time.Second
	}
	probeCtx, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	started := time.Now().UTC()
	result, probeErr := s.Probe(probeCtx, request)
	request.Secret = ""
	if ctx.Err() != nil {
		return out, ctx.Err()
	}
	if probeErr != nil || probeCtx.Err() != nil {
		if kind == "model_discovery" {
			return out, httpx.E(502, "MODEL_DISCOVERY_FAILED", "模型发现未完成，请检查连接或重新尝试")
		}
		reason := "model_call_failed"
		if probeCtx.Err() != nil {
			reason = "cancelled_or_timed_out"
		}
		result, _ = json.Marshal(map[string]any{"diagnostic": map[string]any{"status": "failed", "checks": []any{map[string]any{"name": "request", "status": "failed", "reason": reason}}}})
	}
	clean, e := sanitizeTestResult(kind, result, started, time.Now().UTC())
	if e != nil {
		return out, httpx.E(502, "INVALID_TEST_RESULT", "服务返回了无法识别的测试结果")
	}
	out.Data = clean
	return out, nil
}

type testCheck struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Reason *string `json:"reason,omitempty"`
}
type testUsage struct {
	Input      *int64 `json:"input_tokens"`
	Output     *int64 `json:"output_tokens"`
	CacheRead  *int64 `json:"cache_read_tokens"`
	CacheWrite *int64 `json:"cache_write_tokens"`
	Version    string `json:"normalization_version"`
}
type testDiagnostic struct {
	Kind         string        `json:"kind"`
	Status       string        `json:"status"`
	StartedAt    time.Time     `json:"started_at"`
	FinishedAt   time.Time     `json:"finished_at"`
	Checks       []testCheck   `json:"checks"`
	Capabilities *Capabilities `json:"capabilities,omitempty"`
	Usage        *testUsage    `json:"usage,omitempty"`
}

func sanitizeTestResult(kind string, b json.RawMessage, started, finished time.Time) (json.RawMessage, error) {
	if len(b) > 1<<20 {
		return nil, fmt.Errorf("oversized result")
	}
	if kind == "model_discovery" {
		var v struct {
			Models []struct {
				ID   string  `json:"model_id"`
				Name *string `json:"display_name"`
			} `json:"models"`
			Truncated bool `json:"truncated"`
		}
		if json.Unmarshal(b, &v) != nil || v.Models == nil || len(v.Models) > 1000 {
			return nil, fmt.Errorf("invalid discovery")
		}
		for _, m := range v.Models {
			if len(m.ID) < 1 || len(m.ID) > 255 || m.Name != nil && len(*m.Name) > 1000 {
				return nil, fmt.Errorf("invalid model")
			}
		}
		return json.Marshal(v)
	}
	var v struct {
		Diagnostic testDiagnostic `json:"diagnostic"`
	}
	if json.Unmarshal(b, &v) != nil {
		return nil, fmt.Errorf("invalid diagnostic")
	}
	d := &v.Diagnostic
	if d.Status != "succeeded" && d.Status != "failed" && d.Status != "unsupported" || len(d.Checks) > 32 {
		return nil, fmt.Errorf("invalid status")
	}
	for _, c := range d.Checks {
		if c.Status != "succeeded" && c.Status != "failed" && c.Status != "unsupported" && c.Status != "skipped" {
			return nil, fmt.Errorf("invalid check")
		}
	}
	d.Kind = kind
	d.StartedAt = started
	d.FinishedAt = finished
	if c := d.Capabilities; c != nil {
		for _, v := range []string{c.Text, c.Image, c.Tools, c.Streaming, c.Thinking} {
			if v != "supported" && v != "unsupported" && v != "unknown" {
				return nil, fmt.Errorf("invalid capability")
			}
		}
	}
	if u := d.Usage; u != nil {
		for _, n := range []*int64{u.Input, u.Output, u.CacheRead, u.CacheWrite} {
			if n != nil && *n < 0 {
				return nil, fmt.Errorf("invalid usage")
			}
		}
		if u.Version != "" && u.Version != "chat-completions-v1" && u.Version != "messages-v1-total-input" {
			return nil, fmt.Errorf("invalid usage version")
		}
	}
	return json.Marshal(v)
}
