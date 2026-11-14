package webaccess

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

func testingBusy() error {
	return httpx.E(409, "WEB_ACCESS_TEST_IN_PROGRESS", "此提供商正在测试，请等待完成或停止测试")
}
func (s *Service) isTesting(id uint64) bool { _, ok := s.testing.Load(id); return ok }

// TestProvider reads authorized configuration in a short transaction, then calls
// the fixed probe outside it. Only the latest observation is persisted.
func (s *Service) TestProvider(ctx context.Context, raw string, id uint64, tag string, w ProbeWrite) (*Result, error) {
	var provider Provider
	var secret string
	claimed := false
	defer func() {
		if claimed {
			s.testing.Delete(id)
		}
	}()
	out, err := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, _ *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		if !supports(p.Type, w.Operation) {
			return httpx.E(422, "WEB_ACCESS_CAPABILITY_UNSUPPORTED", "提供商不支持所选能力")
		}
		if !p.Enabled || !p.HasSecret {
			return httpx.E(409, "WEB_ACCESS_UNAVAILABLE", "提供商当前不可用")
		}
		if s.Adapter == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "网络检索适配器暂不可用")
		}
		if _, busy := s.testing.LoadOrStore(id, true); busy {
			return testingBusy()
		}
		claimed = true
		cipher, e := r.Secret(id)
		if e != nil {
			return e
		}
		if s.Cipher == nil {
			return httpx.E(503, "CREDENTIAL_UNAVAILABLE", "无法读取认证信息，请重新配置")
		}
		secret, e = s.Cipher(fmt.Sprintf("webaccess/provider/%d/authentication", id), cipher, false)
		if e != nil {
			return httpx.E(503, "CREDENTIAL_UNAVAILABLE", "无法读取认证信息，请重新配置")
		}
		provider = *p
		return audit(ctx, tx, a, "web_access_provider.test", "web_access_provider", id)
	})
	if err != nil {
		return out, err
	}
	started := time.Now().UTC()
	probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	probeErr := s.probe(probeCtx, provider, secret, w.Operation)
	if probeCtx.Err() != nil {
		probeErr = probeCtx.Err()
	}
	cancel()
	secret = ""
	finished := time.Now().UTC()
	diagnostic := probeDiagnostic(w.Operation, started, finished, probeErr)
	stored := StoredDiagnostic{Snapshot: ProbeSnapshot{provider.ConfigVersion, provider.SecretRevision}, Diagnostic: diagnostic}
	// Cancellation ends the remote call; bounded cleanup records an interrupted
	// observation without retrying. A crash cannot guarantee this write.
	saveCtx, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer saveCancel()
	err = s.background(saveCtx, func(_ identity.Tx, r Repository) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if p == nil {
			return missing()
		}
		return r.RecordDiagnostic(id, w.Operation, stored)
	})
	if err != nil {
		return out, err
	}
	if ctx.Err() != nil {
		return out, ctx.Err()
	}
	out.Data = ProbeResult{Operation: w.Operation, Diagnostic: diagnostic}
	return out, nil
}

func probeDiagnostic(capability string, started, finished time.Time, err error) Diagnostic {
	status := "succeeded"
	var reason *string
	if err != nil {
		status = "failed"
		code := "WEB_ACCESS_PROBE_FAILED"
		var failure *runtime.Failure
		if errors.As(err, &failure) {
			code = failure.Code
			if failure.Unknown {
				status = "interrupted"
			}
		}
		if errors.Is(err, context.Canceled) {
			status, code = "interrupted", "CANCELLED"
		}
		if errors.Is(err, context.DeadlineExceeded) {
			status, code = "interrupted", "WEB_ACCESS_TIMEOUT"
		}
		reason = &code
	}
	return Diagnostic{Kind: "web_access_probe", Status: status, StartedAt: &started, FinishedAt: &finished, Checks: []Check{{Name: capability, Status: status, Reason: reason}}}
}

func (s *Service) GetDiagnostics(ctx context.Context, raw string, id uint64, capability string) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if !supports(p.Type, capability) {
			return httpx.E(422, "WEB_ACCESS_CAPABILITY_UNSUPPORTED", "提供商不支持所选能力")
		}
		out.Data = map[string]any{"latest": nil}
		if len(p.LastDiagnostic) == 0 || string(p.LastDiagnostic) == "null" {
			return nil
		}
		var values map[string]StoredDiagnostic
		if json.Unmarshal(p.LastDiagnostic, &values) != nil {
			return integrity()
		}
		v, ok := values[capability]
		if !ok {
			return nil
		}
		v.Diagnostic.Outdated = p.ConfigVersion != v.Snapshot.ConfigVersion || p.SecretRevision != v.Snapshot.SecretRevision
		out.Data = map[string]any{"latest": v.Diagnostic}
		return nil
	})
}

func (s *Service) probe(ctx context.Context, p Provider, secret, op string) error {
	a, e := s.Adapter(ctx, p, secret)
	if e != nil {
		return e
	}
	if a == nil {
		return runtime.Fail("WEB_ACCESS_ADAPTER_UNAVAILABLE")
	}
	if op == "search" {
		_, e = a.Search(ctx, runtime.SearchRequest{Query: "Go programming language official documentation", MaxResults: 1})
	} else {
		_, e = a.Fetch(ctx, runtime.FetchRequest{URL: "https://example.com", MaxBytes: 64 << 10, MaxRedirects: 3})
	}
	return e
}
