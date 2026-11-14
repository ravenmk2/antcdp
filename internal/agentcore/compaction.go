package agentcore

import (
	"context"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type TokenCounter interface {
	Count(modelcore.Request) (uint64, error)
}
type SummaryCaller interface {
	Summarize(context.Context, CompactionRecord, modelcore.Request) (modelcore.Response, error)
}

// Compactor invokes one visible summary request through a host budget/attempt
// port. The store revalidates source revision/hash under the Session lock and
// assigns the new summary's event sequence atomically with its replacement.
type Compactor struct {
	Store  CompactionStore
	Models SummaryCaller
	Tokens TokenCounter
	Hub    *Hub
}

func (c *Compactor) Compact(ctx context.Context, request CompactionRequest, original modelcore.Request, facts map[Seq]HistoryFact) (CommitReceipt, error) {
	if c.Store == nil || c.Models == nil || c.Tokens == nil || request.Deadline.IsZero() || request.First < 0 || request.Last < request.First || request.Last >= len(request.Source.Entries) {
		return CommitReceipt{}, invalid("compaction")
	}
	sourceHash, err := ContentHash(request.Source)
	if err != nil {
		return CommitReceipt{}, err
	}
	selected := request.Source
	selected.Entries = request.Source.Entries[request.First : request.Last+1]
	oldMessages, err := BuildSurface(selected, facts)
	if err != nil {
		return CommitReceipt{}, err
	}
	countRequest := original
	countRequest.Messages = oldMessages
	before, err := c.Tokens.Count(countRequest)
	if err != nil {
		return CommitReceipt{}, err
	}
	record, err := c.Store.Begin(ctx, request)
	if err != nil {
		return CommitReceipt{}, err
	}
	failed := func(reason string, cause error) (CommitReceipt, error) {
		finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		receipt, commitErr := c.Store.Fail(finish, CompactionFailure{Record: record, Reason: reason})
		if commitErr != nil {
			return CommitReceipt{}, commitErr
		}
		if c.Hub != nil {
			c.Hub.Committed(finish, receipt)
		}
		return receipt, cause
	}
	callCtx, cancel := context.WithDeadline(ctx, request.Deadline)
	response, err := c.Models.Summarize(callCtx, record, original)
	if err == nil {
		err = callCtx.Err()
	}
	cancel()
	if err != nil {
		return failed("COMPACTION_MODEL_FAILED", err)
	}
	if strings.TrimSpace(response.Message.Content) == "" || len(response.Message.ToolCalls) > 0 {
		return failed("COMPACTION_INVALID_SUMMARY", reject("COMPACTION_INVALID_SUMMARY"))
	}
	// The caller supplies a request containing only the selected complete
	// interval plus stable system/tools and a final summary instruction.
	summaryRequest := original
	summaryRequest.Messages = []modelcore.Message{{Role: "user", Content: response.Message.Content}}
	after, err := c.Tokens.Count(summaryRequest)
	if err != nil {
		return failed("COMPACTION_ESTIMATE_FAILED", err)
	}
	if after >= before {
		return failed("COMPACTION_NOT_SMALLER", reject("COMPACTION_NOT_SMALLER"))
	}
	r := Replacement{SourceRevision: request.Source.Revision, First: request.First, Last: request.Last, SourceHash: sourceHash, Summary: response.Message.Content, BeforeTokens: before, AfterTokens: after}
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	receipt, err := c.Store.CommitReplacement(finish, CompactionResult{Record: record, Replacement: r, Usage: response.Usage})
	if err != nil {
		return failed("COMPACTION_COMMIT_FAILED", err)
	}
	if c.Hub != nil {
		c.Hub.Committed(finish, receipt)
	}
	return receipt, nil
}

// CompactionRange preserves the most recent task and at least retain entries.
// Tool groups are indivisible entries; incomplete groups never enter Surface.
func CompactionRange(manifest SurfaceManifest, facts map[Seq]HistoryFact, retain int) (int, int, error) {
	if retain < 1 {
		return 0, 0, invalid("retain")
	}
	last := len(manifest.Entries) - retain - 1
	for n := len(manifest.Entries) - 1; n >= 0; n-- {
		found := false
		for _, seq := range manifest.Entries[n].Sequences {
			if f, ok := facts[seq]; ok && f.Kind == "input/message" {
				if n-1 < last {
					last = n - 1
				}
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if last < 0 {
		return 0, 0, reject("COMPACTION_NOT_NEEDED")
	}
	return 0, last, nil
}
