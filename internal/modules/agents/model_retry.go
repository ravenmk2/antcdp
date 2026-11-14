package agents

import (
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

// Stored with the failed attempt so duplicate settlement cannot resample jitter
// or change an already announced decision. It contains no provider diagnostics.
type modelRetry struct {
	Number     int       `json:"number"`
	MaxRetries int       `json:"max_retries"`
	DelayMS    int64     `json:"delay_ms"`
	RetryAt    time.Time `json:"retry_at"`
	Stage      string    `json:"stage"`
}

func restoreRetry(out *agentcore.AttemptCommit, retry *modelRetry) {
	if retry == nil {
		return
	}
	out.Retry = true
	out.RetryAfter = max(0, time.Until(retry.RetryAt))
}
