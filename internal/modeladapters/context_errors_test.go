package modeladapters

import (
	"errors"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestContextOverflowClassificationIsNarrow(t *testing.T) {
	for _, test := range []struct {
		body string
		want bool
	}{
		{`{"error":{"code":"context_length_exceeded","message":"private prompt details"}}`, true},
		{`{"error":{"type":"invalid_request_error","message":"prompt is too long: 140000 tokens > 128000 maximum"}}`, true},
		{`{"error":{"message":"This model's maximum context length is 128000 tokens. However, you requested 140000 tokens."}}`, true},
		{`{"error":{"message":"max_tokens is invalid"}}`, false},
		{`{"error":{"message":"request body too large"}}`, false},
		{`{"error":{"code":"rate_limit_exceeded"}}`, false},
		{`not json`, false},
	} {
		if got := contextOverflow([]byte(test.body)); got != test.want {
			t.Fatalf("classification=%v want=%v", got, test.want)
		}
	}
	err := &RemoteError{Status: 400, ContextOverflow: true}
	if !errors.Is(err, modelcore.ErrContextWindowExceeded) || errors.Is(err, modelcore.ErrRemoteService) {
		t.Fatal("overflow class lost")
	}
}
