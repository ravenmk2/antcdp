package agentcore

import (
	"context"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

const (
	DefaultModelRetries   = 5
	UnlimitedModelRetries = -1
	MaxModelRetryDelay    = 10 * time.Second
)

// CanRetryModelAttempt counts completed attempts, including the initial call.
func CanRetryModelAttempt(attempt uint64, limit int64) bool {
	return attempt > 0 && (limit == UnlimitedModelRetries || limit > 0 && attempt <= uint64(limit))
}

// ModelRetryDelay applies only to transient model failures. The caller persists
// the decision before waiting and still enforces run deadlines and budgets.
// sample is a uniform value in [0,1), supplied separately for deterministic tests.
func ModelRetryDelay(out AttemptOutcome, attempt uint64, limit int64, sample float64) (time.Duration, bool) {
	if out.Cancelled || !CanRetryModelAttempt(attempt, limit) || errors.Is(out.Err, context.Canceled) || errors.Is(out.Err, context.DeadlineExceeded) {
		return 0, false
	}
	var execution *Error
	retryable := errors.As(out.Err, &execution) && execution.Code == "MODEL_ATTEMPT_TIMEOUT"
	for _, cause := range []error{modelcore.ErrTransport, modelcore.ErrTransportTimeout, modelcore.ErrIncompleteStream, modelcore.ErrEmptyResponse, modelcore.ErrRateLimited, modelcore.ErrRemoteService} {
		retryable = retryable || errors.Is(out.Err, cause)
	}
	if !retryable {
		return 0, false
	}
	var provider interface{ RetryDelay() time.Duration }
	if errors.As(out.Err, &provider) && provider.RetryDelay() > 0 {
		delay := provider.RetryDelay()
		return delay, delay <= MaxModelRetryDelay
	}
	shift := min(attempt-1, 5)
	delay := time.Duration(float64(500*time.Millisecond<<shift) * (0.9 + 0.2*sample))
	return min(delay, MaxModelRetryDelay), true
}
