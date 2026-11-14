package agentcore

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type retryInstruction struct{ delay time.Duration }

func (e retryInstruction) Error() string             { return "safe instruction" }
func (e retryInstruction) Unwrap() error             { return modelcore.ErrRateLimited }
func (e retryInstruction) RetryDelay() time.Duration { return e.delay }

func TestModelRetryEligibilityAndLimits(t *testing.T) {
	for _, tc := range []struct {
		err   error
		retry bool
	}{
		{modelcore.ErrTransport, true}, {modelcore.ErrTransportTimeout, true},
		{modelcore.ErrIncompleteStream, true}, {modelcore.ErrEmptyResponse, true},
		{modelcore.ErrRemoteService, true}, {modelcore.ErrRateLimited, true},
		{&Error{Code: "MODEL_ATTEMPT_TIMEOUT"}, true},
		{modelcore.ErrGenerationLimit, false}, {modelcore.ErrOutputLimit, false},
		{modelcore.ErrInvalidResponse, false}, {modelcore.ErrAuthenticationFailed, false},
		{modelcore.ErrRequestRejected, false}, {modelcore.ErrInvalidRequest, false},
		{context.Canceled, false}, {context.DeadlineExceeded, false},
		{&Error{Code: "MODEL_STREAM_DELIVERY_FAILED"}, false}, {nil, false},
	} {
		t.Run(fmt.Sprint(tc.err), func(t *testing.T) {
			for attempt := uint64(1); attempt <= 7; attempt++ {
				_, ok := ModelRetryDelay(AttemptOutcome{Err: tc.err}, attempt, .5)
				if ok != (tc.retry && attempt < MaxModelAttempts) {
					t.Fatalf("attempt %d retry=%v", attempt, ok)
				}
			}
			if _, ok := ModelRetryDelay(AttemptOutcome{Err: tc.err, Cancelled: true}, 1, .5); ok {
				t.Fatal("cancellation retried")
			}
		})
	}
}

func TestModelRetryBackoffAndProviderInstruction(t *testing.T) {
	for attempt := uint64(1); attempt < MaxModelAttempts; attempt++ {
		base := 500 * time.Millisecond * time.Duration(1<<(attempt-1))
		for _, sample := range []float64{0, .5, 1} {
			delay, ok := ModelRetryDelay(AttemptOutcome{Err: modelcore.ErrTransport}, attempt, sample)
			if !ok || delay < base*9/10 || delay > base*11/10 || delay > MaxModelRetryDelay {
				t.Fatalf("backoff %v %v", delay, ok)
			}
		}
	}
	for _, delay := range []time.Duration{2 * time.Second, 10 * time.Second, 11 * time.Second, 24 * time.Hour} {
		actual, ok := ModelRetryDelay(AttemptOutcome{Err: fmt.Errorf("wrapped: %w", retryInstruction{delay})}, 1, .5)
		if ok != (delay <= MaxModelRetryDelay) || ok && actual != delay {
			t.Fatal("provider instruction not respected", actual, ok)
		}
	}
}
