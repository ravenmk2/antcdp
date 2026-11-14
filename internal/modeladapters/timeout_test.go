package modeladapters

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type timeoutTransport struct{}

func (timeoutTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, &net.DNSError{Err: "private connection detail", Name: "private-target", IsTimeout: true}
}

func TestTransportTimeoutDoesNotBecomeContextDeadline(t *testing.T) {
	client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: "https://example.invalid", APIKey: "synthetic-key"}, &http.Client{Transport: timeoutTransport{}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Generate(t.Context(), testRequest(modelcore.ChatCompletions), nil)
	if !errors.Is(err, modelcore.ErrTransportTimeout) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "private") {
		t.Fatalf("transport timeout misclassified or leaked: %v", err)
	}
	if diagnosticReason(err) != "transport_timed_out" {
		t.Fatal("diagnostic lost transport timeout")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = client.Generate(ctx, testRequest(modelcore.ChatCompletions), nil)
	if !errors.Is(err, context.Canceled) || errors.Is(err, modelcore.ErrTransportTimeout) {
		t.Fatalf("caller cancellation became transport timeout: %v", err)
	}
}
