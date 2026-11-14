package mysql

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	w "github.com/ravenmk2/antcdp/internal/modules/webaccess"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"webaccess", agentWebAccessLifecycle})
}

type retrievalFixtureAdapter struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (a *retrievalFixtureAdapter) Search(ctx context.Context, _ runtime.SearchRequest) (runtime.SearchResult, error) {
	if a.entered != nil {
		a.once.Do(func() { close(a.entered) })
		select {
		case <-ctx.Done():
			return runtime.SearchResult{}, ctx.Err()
		case <-a.release:
		}
	}
	return runtime.SearchResult{Results: []runtime.SearchEntry{}}, nil
}
func (*retrievalFixtureAdapter) Fetch(context.Context, runtime.FetchRequest) (runtime.FetchResult, error) {
	return runtime.FetchResult{Title: "Fixture", Content: "Public fixed content", MediaType: "text/plain"}, nil
}
func agentWebAccessLifecycle(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw := f.Context, f.AdminToken
	adapter := &retrievalFixtureAdapter{}
	svc := &w.Service{Identity: f.Identity, Store: func() (identity.Store, error) { return f.Store, nil }, ETag: func(v string) string {
		mac := hmac.New(sha256.New, cryptox.Derive(f.Key, "webaccess-etags"))
		mac.Write([]byte(v))
		return hex.EncodeToString(mac.Sum(nil))
	}, Cipher: func(purpose, value string, seal bool) (string, error) {
		if seal {
			return cryptox.Encrypt(f.Key, f.Installation, purpose, value)
		}
		return cryptox.Decrypt(f.Key, f.Installation, purpose, value)
	}, Adapter: func(_ context.Context, _ w.Provider, _ string) (runtime.Adapter, error) { return adapter, nil }, Reader: &retrievalFixtureAdapter{}}
	settings, e := svc.GetSettings(ctx, raw)
	if e != nil {
		t.Fatal(e)
	}
	initial := settings.Data.(*w.Settings)
	if len(initial.Search.Routes) != 0 || len(initial.Fetch.Routes) != 0 || initial.Search.MaxResults != 5 {
		t.Fatal("unexpected seed", initial)
	}
	secret := "web-access-credential-fixture"
	input := w.ProviderCreate{Name: "Retrieval primary", Type: "deepseek", Config: &w.Config{BaseURL: "https://retrieval.example.test", Timeout: 15}, Authentication: &w.AuthenticationWrite{Method: "api_key", Secret: models.SecretWrite{Operation: "replace", Value: &secret}}}
	created, e := svc.CreateProvider(ctx, raw, input)
	if e != nil {
		t.Fatal(e)
	}
	p := created.Data.(*w.Provider)
	id := strconv.FormatUint(p.ID, 10)
	_, e = svc.CreateProvider(ctx, raw, input)
	modelsExpectCode(t, e, "NAME_CONFLICT")
	b, _ := json.Marshal(created.Data)
	if strings.Contains(string(b), secret) || strings.Contains(string(b), "secret_revision") {
		t.Fatal("credential disclosed")
	}
	var cipher string
	if e = f.Store.db.GetContext(ctx, &cipher, "SELECT secret_ciphertext FROM web_access_provider WHERE id=?", p.ID); e != nil {
		t.Fatal(e)
	}
	if cipher == secret {
		t.Fatal("credential stored in plaintext")
	}
	if _, e = cryptox.Decrypt(f.Key, f.Installation, fmt.Sprintf("models/provider/%d/authentication", p.ID), cipher); e == nil {
		t.Fatal("credential crossed module purpose")
	}
	setting := initial.Settings
	setting.Search.Routes = []runtime.RouteRef{{Kind: "provider", ID: id}}
	setting.Fetch.Routes = []runtime.RouteRef{{Kind: "provider", ID: id}, {Kind: "builtin", ID: "http"}}
	selected, e := svc.PutSettings(ctx, raw, settings.Tag, setting)
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.PutSettings(ctx, raw, settings.Tag, setting)
	modelsExpectCode(t, e, "VERSION_CONFLICT")
	_, e = svc.DeleteProvider(ctx, raw, p.ID, created.Tag)
	modelsExpectCode(t, e, "RESOURCE_IN_USE")
	_, e = svc.PatchProvider(ctx, raw, p.ID, created.Tag, w.ProviderPatch{Config: w.Field[w.Config]{Set: true, Value: w.Config{BaseURL: "https://other.example.test", Timeout: 15}}})
	modelsExpectCode(t, e, "RESOURCE_IN_USE")
	state, e := svc.GetState(ctx, raw)
	if e != nil || !state.Data.(w.State).Search.Available {
		t.Fatal("configured state", e)
	}
	for _, capability := range []string{"search", "fetch"} {
		tested, err := svc.TestProvider(ctx, raw, p.ID, created.Tag, w.ProbeWrite{Operation: capability})
		if err != nil || tested.Status != 200 || tested.Data.(w.ProbeResult).Diagnostic.Status != "succeeded" {
			t.Fatal("synchronous probe", err)
		}
	}
	unchanged, e := svc.GetProvider(ctx, raw, p.ID)
	if e != nil || unchanged.Tag != created.Tag {
		t.Fatal("diagnostic changed edit version", e)
	}
	for _, capability := range []string{"search", "fetch"} {
		diagnosed, err := svc.GetDiagnostics(ctx, raw, p.ID, capability)
		if err != nil {
			t.Fatal(err)
		}
		value := diagnosed.Data.(map[string]any)["latest"].(w.Diagnostic)
		if value.Outdated || value.Status != "succeeded" {
			t.Fatal("capability result overwritten", capability)
		}
	}
	rotatedSecret := "rotated-web-credential"
	rotated, e := svc.UpdateAuthentication(ctx, raw, p.ID, created.Tag, w.AuthenticationWrite{Method: "api_key", Secret: models.SecretWrite{Operation: "replace", Value: &rotatedSecret}})
	if e != nil {
		t.Fatal(e)
	}
	diagnosed, e := svc.GetDiagnostics(ctx, raw, p.ID, "fetch")
	if e != nil || !diagnosed.Data.(map[string]any)["latest"].(w.Diagnostic).Outdated {
		t.Fatal("rotation failed to invalidate observation", e)
	}
	var removed int
	if err := f.Store.db.GetContext(ctx, &removed, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('web_access_operation','web_access_command_receipt')"); err != nil || removed != 0 {
		t.Fatal("obsolete tables", removed, err)
	}
	// Active read leases outlive removing a configured route and prevent deleting
	// the connection while its response remains outstanding.
	adapter = &retrievalFixtureAdapter{entered: make(chan struct{}), release: make(chan struct{})}
	callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	doneCall := make(chan error, 1)
	resolved, e := svc.Resolve(callCtx, runtime.RouteRef{Kind: "provider", ID: id}, runtime.Search)
	if e != nil {
		t.Fatal(e)
	}
	go func() {
		_, err := resolved.Search(callCtx, runtime.SearchRequest{Query: "fixed", MaxResults: 1})
		doneCall <- err
	}()
	select {
	case <-adapter.entered:
	case <-callCtx.Done():
		t.Fatal("call did not enter")
	}
	setting.Search.Routes = []runtime.RouteRef{}
	setting.Fetch.Routes = []runtime.RouteRef{}
	if _, e = svc.PutSettings(ctx, raw, selected.Tag, setting); e != nil {
		t.Fatal(e)
	}
	_, e = svc.DeleteProvider(ctx, raw, p.ID, rotated.Tag)
	modelsExpectCode(t, e, "RESOURCE_IN_USE")
	close(adapter.release)
	if e = <-doneCall; e != nil {
		t.Fatal(e)
	}
	// A synchronous probe holds only the provider test claim, not a transaction.
	adapter = &retrievalFixtureAdapter{entered: make(chan struct{}), release: make(chan struct{})}
	probeCtx, stopProbe := context.WithCancel(ctx)
	probeDone := make(chan error, 1)
	go func() {
		_, err := svc.TestProvider(probeCtx, raw, p.ID, rotated.Tag, w.ProbeWrite{Operation: "search"})
		probeDone <- err
	}()
	select {
	case <-adapter.entered:
	case <-time.After(5 * time.Second):
		stopProbe()
		t.Fatal("probe never entered")
	}
	_, e = svc.TestProvider(ctx, raw, p.ID, rotated.Tag, w.ProbeWrite{Operation: "fetch"})
	modelsExpectCode(t, e, "WEB_ACCESS_TEST_IN_PROGRESS")
	_, e = svc.PatchProvider(ctx, raw, p.ID, rotated.Tag, w.ProviderPatch{Name: w.Field[string]{Set: true, Value: "Blocked edit"}})
	modelsExpectCode(t, e, "WEB_ACCESS_TEST_IN_PROGRESS")
	_, e = svc.UpdateAuthentication(ctx, raw, p.ID, rotated.Tag, w.AuthenticationWrite{Method: "api_key", Secret: models.SecretWrite{Operation: "replace", Value: &secret}})
	modelsExpectCode(t, e, "WEB_ACCESS_TEST_IN_PROGRESS")
	_, e = svc.DeleteProvider(ctx, raw, p.ID, rotated.Tag)
	modelsExpectCode(t, e, "WEB_ACCESS_TEST_IN_PROGRESS")
	stopProbe()
	select {
	case e = <-probeDone:
		if e != context.Canceled {
			t.Fatal("cancelled probe", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled probe did not release")
	}
	latest, e := svc.GetDiagnostics(ctx, raw, p.ID, "search")
	if e != nil || latest.Data.(map[string]any)["latest"].(w.Diagnostic).Status != "interrupted" {
		t.Fatal("cancelled diagnostic", e)
	}
	deleted, e := svc.DeleteProvider(ctx, raw, p.ID, rotated.Tag)
	if e != nil || deleted.Status != 204 {
		t.Fatal("delete", e)
	}
	_, e = svc.GetProvider(ctx, raw, p.ID)
	modelsExpectCode(t, e, "NOT_FOUND")
}
