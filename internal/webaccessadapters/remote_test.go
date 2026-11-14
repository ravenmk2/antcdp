package webaccessadapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/netguard"
	"github.com/ravenmk2/antcdp/internal/webaccess"
)

func TestRegisteredSearchRoutesReturnBoundedFacts(t *testing.T) {
	for _, provider := range []string{"deepseek", "glm"} {
		t.Run(provider, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-key" || r.Method != "POST" {
					t.Error("auth or method lost")
				}
				var input map[string]any
				if json.NewDecoder(r.Body).Decode(&input) != nil {
					t.Error("invalid request")
				}
				if input["count"] != float64(2) {
					t.Error("result budget lost")
				}
				w.Header().Set("Content-Type", "application/json")
				if provider == "deepseek" {
					if r.URL.Path != "/v1/tools/search" || input["query"] != "go documentation" || input["need_content"] != false {
						t.Error("incorrect DeepSeek contract")
					}
					_, _ = fmt.Fprint(w, `{"results":[{"title":"Go","url":"https://go.dev/doc/","summary":"Documentation","date":null}]}`)
				} else {
					if r.URL.Path != "/api/paas/v4/web_search" || input["search_query"] != "go documentation" || input["search_engine"] != "search_pro" {
						t.Error("incorrect GLM contract")
					}
					_, _ = fmt.Fprint(w, `{"search_result":[{"title":"Go","link":"https://go.dev/doc/","content":"Documentation","publish_date":"2026-01-01"}]}`)
				}
			}))
			defer server.Close()
			adapter, err := NewRemote(Config{Provider: provider, BaseURL: server.URL, APIKey: "test-key", Timeout: time.Second}, nil)
			if err != nil {
				t.Fatal(err)
			}
			result, err := adapter.Search(t.Context(), webaccess.SearchRequest{Query: "go documentation", MaxResults: 2})
			if err != nil || len(result.Results) != 1 || result.Results[0].URL != "https://go.dev/doc/" || result.Results[0].Summary != "Documentation" {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if provider == "deepseek" && result.Results[0].PublishedAt != nil {
				t.Fatal("publication date fabricated")
			}
		})
	}
}

func TestRemoteRejectsPolicyDenialAndRedirectWithoutCredentialLeak(t *testing.T) {
	for _, status := range []int{403, 302, 429, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			leaked := false
			other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked = true }))
			defer other.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Location", other.URL)
				w.WriteHeader(status)
				_, _ = fmt.Fprint(w, "secret-error-body")
			}))
			defer server.Close()
			adapter, err := NewRemote(Config{Provider: "deepseek", BaseURL: server.URL, APIKey: "secret-key", Timeout: time.Second}, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = adapter.Search(t.Context(), webaccess.SearchRequest{Query: "query", MaxResults: 2})
			if err == nil || leaked || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), server.URL) {
				t.Fatal("unsafe provider failure", err)
			}
			if webaccess.CanFallback(err) != (status == 429 || status == 500) {
				t.Fatal("wrong fallback policy", err)
			}
		})
	}
}

type publicResolver struct{}

func (publicResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
}

func TestRemoteFetchNeverExposesInternalTargetAndMarksTruncation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/tools/fetch" {
			t.Error("wrong fetch path")
		}
		var payload map[string]string
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if payload["url"] != "https://public.example/article" {
			t.Error("unexpected target sent")
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"title": "test", "content": strings.Repeat("文", 30000)})
	}))
	defer server.Close()
	adapter, err := NewRemote(Config{Provider: "deepseek", BaseURL: server.URL, APIKey: "test-key", Timeout: time.Second}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = adapter.Fetch(t.Context(), webaccess.FetchRequest{URL: "http://10.0.0.1/private", MaxBytes: 64 << 10, AllowedInternalHosts: []string{"10.0.0.1"}})
	if err == nil || calls != 0 {
		t.Fatal("private target leaked", err)
	}
	adapter.policy = netguard.Policy{Resolver: publicResolver{}}
	result, err := adapter.Fetch(t.Context(), webaccess.FetchRequest{URL: "https://public.example/article", MaxBytes: 64 << 10})
	if err != nil || !result.Truncated || len(result.Content) > 64<<10 || result.FinalURL != nil || result.MediaType != "text/markdown" {
		t.Fatalf("fetch size=%d truncated=%v final=%v err=%v", len(result.Content), result.Truncated, result.FinalURL, err)
	}
}

func TestSearchMalformedAndEmptyResponsesRemainDistinct(t *testing.T) {
	for _, body := range []string{`{"results":[]}`, `{}`, `{"results":null}`, `not JSON`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = fmt.Fprint(w, body) }))
		adapter, err := NewRemote(Config{Provider: "deepseek", BaseURL: server.URL, APIKey: "test-key", Timeout: time.Second}, nil)
		if err != nil {
			t.Fatal(err)
		}
		result, err := adapter.Search(t.Context(), webaccess.SearchRequest{Query: "query", MaxResults: 2})
		server.Close()
		if (err == nil) != (body == `{"results":[]}`) {
			t.Fatalf("body=%s result=%+v err=%v", body, result, err)
		}
	}
}

func TestReaderExtractsTextWithoutScriptsAndEnforcesTargetPolicy(t *testing.T) {
	title, body := plainHTML(`<html><head><title>标题 &amp; 文档</title><style>hidden-style</style></head><body>Hello <b>world</b><script>hidden-script</script><template>hidden-template</template><p>正文</p></body></html>`)
	if title != "标题 & 文档" || body != "Hello world 正文" {
		t.Fatalf("title=%s text=%s", title, body)
	}
	reader := Reader{}
	_, err := reader.Fetch(t.Context(), webaccess.FetchRequest{URL: "http://127.0.0.1/private", MaxBytes: 64 << 10, AllowedInternalHosts: []string{"127.0.0.1"}})
	var failure *webaccess.Failure
	if !errors.As(err, &failure) || failure.Code != "WEB_ACCESS_TARGET_NOT_ALLOWED" {
		t.Fatal("reader reached local control plane", err)
	}
}
