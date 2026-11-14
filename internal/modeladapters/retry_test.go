package modeladapters

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestRetryAfterIsSafeAndDoesNotRetryInsideAdapter(t *testing.T) {
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		t.Run(string(protocol), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				w.Header().Set("Retry-After", "2")
				w.WriteHeader(429)
				_, _ = w.Write([]byte("private upstream body"))
			}))
			defer server.Close()
			client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: protocol, BaseURL: server.URL, APIKey: "test"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Generate(t.Context(), testRequest(protocol), nil)
			var remote *RemoteError
			if !errors.As(err, &remote) || remote.RetryDelay() != 2*time.Second || calls != 1 || strings.Contains(err.Error(), "private") {
				t.Fatal("retry metadata or one-attempt boundary", err, calls)
			}
		})
	}
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		raw  string
		want time.Duration
	}{
		{"2", 2 * time.Second}, {now.Add(3 * time.Second).Format(http.TimeFormat), 3 * time.Second},
		{"-1", 0}, {"invalid", 0}, {"0", 0}, {now.Add(-time.Second).Format(http.TimeFormat), 0},
		{"999999", 24 * time.Hour},
	} {
		if got := retryAfter(tc.raw, now); got != tc.want {
			t.Fatalf("%q: %v", tc.raw, got)
		}
	}
}

func TestStreamTerminationClassification(t *testing.T) {
	chat := func(reason, content string) string {
		return `data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"` + content + `"},"finish_reason":"` + reason + `"}]}` + "\n\ndata: [DONE]\n\n"
	}
	messages := func(reason string) string {
		return "data: {\"type\":\"message_start\",\"message\":{\"id\":\"m\",\"role\":\"assistant\",\"content\":[]}}\n\n" + `data: {"type":"message_delta","delta":{"stop_reason":"` + reason + `"}}` + "\n\ndata: {\"type\":\"message_stop\"}\n\n"
	}
	for _, tc := range []struct {
		name, body string
		messages   bool
		want       error
	}{
		{"chat empty", chat("stop", ""), false, modelcore.ErrEmptyResponse},
		{"chat length", chat("length", "partial"), false, modelcore.ErrGenerationLimit},
		{"chat filtered", chat("content_filter", "partial"), false, modelcore.ErrInvalidResponse},
		{"chat missing terminal", strings.ReplaceAll(chat("stop", "partial"), "data: [DONE]\n\n", ""), false, modelcore.ErrIncompleteStream},
		{"chat length without terminal", strings.ReplaceAll(chat("length", "partial"), "data: [DONE]\n\n", ""), false, modelcore.ErrGenerationLimit},
		{"messages empty", messages("end_turn"), true, modelcore.ErrEmptyResponse},
		{"messages limit", messages("max_tokens"), true, modelcore.ErrGenerationLimit},
		{"messages missing terminal", strings.ReplaceAll(messages("end_turn"), "data: {\"type\":\"message_stop\"}\n\n", ""), true, modelcore.ErrIncompleteStream},
		{"messages malformed", "data: broken\n\n", true, modelcore.ErrInvalidResponse},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var err error
			if tc.messages {
				_, err = decodeMessages(t.Context(), strings.NewReader(tc.body), func(modelcore.Delta) error { return nil })
			} else {
				_, err = decodeChat(t.Context(), strings.NewReader(tc.body), func(modelcore.Delta) error { return nil })
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
		})
	}
}
