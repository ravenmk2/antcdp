package modeladapters

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestRemoteFailuresExposeOnlySafeClasses(t *testing.T) {
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		for _, test := range []struct {
			status int
			want   error
		}{
			{429, modelcore.ErrRateLimited},
			{401, modelcore.ErrAuthenticationFailed},
			{403, modelcore.ErrAuthenticationFailed},
			{400, modelcore.ErrRequestRejected},
			{402, modelcore.ErrRequestRejected},
			{404, modelcore.ErrRequestRejected},
			{422, modelcore.ErrRequestRejected},
			{307, modelcore.ErrRequestRejected},
			{500, modelcore.ErrRemoteService},
			{502, modelcore.ErrRemoteService},
			{503, modelcore.ErrRemoteService},
			{504, modelcore.ErrRemoteService},
		} {
			t.Run(fmt.Sprintf("%s/%d", protocol, test.status), func(t *testing.T) {
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					calls.Add(1)
					w.Header().Set("X-Private", "private-response-header")
					w.WriteHeader(test.status)
					_, _ = fmt.Fprint(w, `{"error":{"message":"private-response-body synthetic-secret"}}`)
				}))
				defer server.Close()
				client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: protocol, BaseURL: server.URL, APIKey: "synthetic-secret"}, nil)
				if err != nil {
					t.Fatal(err)
				}
				response, err := client.Generate(t.Context(), testRequest(protocol), nil)
				if !errors.Is(err, test.want) || calls.Load() != 1 || len(response.Message.ToolCalls) != 0 {
					t.Fatalf("classification or retry behavior changed: %v, calls=%d", err, calls.Load())
				}
				for current := err; current != nil; current = errors.Unwrap(current) {
					for _, secret := range []string{"synthetic-secret", "private-response", server.URL} {
						if strings.Contains(current.Error(), secret) {
							t.Fatal("remote failure retained private details")
						}
					}
				}
			})
		}
	}
}

type failedConnectionTransport struct{ calls atomic.Int32 }

func (t *failedConnectionTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.calls.Add(1)
	return nil, &net.DNSError{Err: "private DNS detail", Name: "private-host", IsNotFound: true}
}

func TestConnectionFailureDropsOriginalNetworkError(t *testing.T) {
	transport := &failedConnectionTransport{}
	client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: "https://example.invalid", APIKey: "synthetic-secret"}, &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Generate(t.Context(), testRequest(modelcore.ChatCompletions), nil)
	var dns *net.DNSError
	if !errors.Is(err, modelcore.ErrTransport) || errors.Is(err, modelcore.ErrTransportTimeout) || errors.As(err, &dns) || transport.calls.Load() != 1 {
		t.Fatalf("connection failure class, privacy or retry changed: %v", err)
	}
	if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "synthetic-secret") {
		t.Fatal("connection failure leaked private details")
	}
}
