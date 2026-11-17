package agents

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
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

// Recovery eligibility is recorded with the failed attempt. It does not admit
// resending that request: FreezeAttempt requires a smaller committed surface.
func contextRecoveryEligible(st StateRepository, call *ModelCallRow, outcome agentcore.AttemptOutcome, observedTools bool) (bool, error) {
	if !errors.Is(outcome.Err, modelcore.ErrContextWindowExceeded) || outcome.Cancelled || outcome.StreamStarted || observedTools || outcome.Response.Message.Content != "" || outcome.Response.Message.Reasoning != "" || call.RunID == nil || call.AttemptNo >= agentcore.MaxModelAttempts {
		return false, nil
	}
	for attempt := uint64(1); attempt < call.AttemptNo; attempt++ {
		prior, err := st.AttemptForStep(*call.RunID, call.StepNo, attempt)
		if err != nil {
			return false, err
		}
		if prior == nil {
			return false, integrity()
		}
		if prior.ErrorCode != nil && *prior.ErrorCode == "CONTEXT_BUDGET_EXCEEDED" {
			return false, nil
		}
	}
	return true, nil
}

func contextRecoveryReduced(prior *ModelCallRow, step agentcore.PreparedStep) (bool, error) {
	if prior.Status != "failed" || prior.ErrorCode == nil || *prior.ErrorCode != "CONTEXT_BUDGET_EXCEEDED" {
		return false, nil
	}
	var source agentcore.SurfaceManifest
	var snapshot attemptSnapshot
	if json.Unmarshal(prior.SurfaceManifest, &source) != nil || json.Unmarshal(prior.RequestConfig, &snapshot) != nil {
		return false, integrity()
	}
	if step.Manifest.Revision <= source.Revision || snapshot.InputEstimate == nil {
		return false, nil
	}
	envelope, err := snapshotEnvelope(prior)
	if err != nil {
		return false, err
	}
	compatible, err := agentcore.SameContextEnvelope(step.Request, envelope)
	if err != nil || !compatible {
		return false, err
	}
	estimate, err := modelcore.EstimateRequestTokens(step.Request)
	return estimate < *snapshot.InputEstimate, err
}
