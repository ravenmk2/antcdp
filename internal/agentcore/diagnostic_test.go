package agentcore

import (
	"context"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func TestRunDiagnosticKeepsTerminationSemantics(t *testing.T) {
	for _, original := range []error{context.Canceled, context.DeadlineExceeded, httpx.E(409, "CLOUD_NOT_READY", "private host details")} {
		before := executionEnd(original)
		after := executionEnd(diagnostic.With(original, diagnostic.Detail{Source: "sandbox", Stage: "prepare"}))
		if before.Status != after.Status || before.Reason != after.Reason {
			t.Fatal("diagnostic changed run ending", before, after)
		}
		if after.Diagnostic == nil || after.Diagnostic.Stage != "prepare" {
			t.Fatal("missing diagnostic")
		}
	}
}

func TestDiagnosticPreservesRetryPolicy(t *testing.T) {
	for _, original := range []error{modelcore.ErrTransport, modelcore.ErrAuthenticationFailed, context.Canceled, context.DeadlineExceeded, retryInstruction{2 * time.Second}, retryInstruction{24 * time.Hour}} {
		wrapped := diagnostic.With(original, diagnostic.Detail{Source: "model", Stage: "request", HTTPStatus: 503})
		for attempt := uint64(1); attempt <= DefaultModelRetries+1; attempt++ {
			before, retryBefore := ModelRetryDelay(AttemptOutcome{Err: original}, attempt, DefaultModelRetries, .5)
			after, retryAfter := ModelRetryDelay(AttemptOutcome{Err: wrapped}, attempt, DefaultModelRetries, .5)
			if before != after || retryBefore != retryAfter {
				t.Fatalf("diagnostic changed retry policy for %v at attempt %d", original, attempt)
			}
		}
	}
}
