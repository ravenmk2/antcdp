package mysql

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type outputPressureCounter struct{ high uint64 }

func (c outputPressureCounter) Count(request modelcore.Request) (uint64, error) {
	for _, m := range request.Messages {
		if m.Role == "tool" && len(m.Content) > 8192 {
			return c.high, nil
		}
	}
	return 1, nil
}

func runtimeToolOutput(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "retain full output and retrieve its diagnostic")
	commit := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "large", Name: "echo", Arguments: `{}`}, {ID: "parallel", Name: "echo", Arguments: `{}`}}})
	full := "BEGIN\n" + strings.Repeat("普通日志😀\n", 20000) + "\nERROR: retained-tail"
	var ids []uint64
	for i, call := range commit.Calls {
		if _, err := f.Agents.PrepareDispatch(f.Context, x.Ref, call.ID); err != nil {
			t.Fatal(err)
		}
		yes := true
		text := full
		if i == 1 {
			text = "other tool"
		}
		result, err := f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: text}})
		if err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			continue
		}
		if !strings.Contains(result.Result.Content, "retained-tail") || !strings.Contains(result.Result.Content, "read_tool_output") || len(result.Result.Content) > core.ToolOutputInlineBytes {
			t.Fatal("preview lost tail or reference")
		}
		var payload []byte
		if err = f.Store.db.GetContext(f.Context, &payload, "SELECT payload FROM agent_event WHERE session_id=? AND seq=?", session.Configuration.ID, uint64(result.Receipt.ToolResultSeq)); err != nil {
			t.Fatal(err)
		}
		var stored struct {
			Public struct {
				Output a.ToolOutputReference `json:"output_file"`
			} `json:"public"`
		}
		if json.Unmarshal(payload, &stored) != nil || stored.Public.Output.FileID == 0 {
			t.Fatal("missing durable output binding")
		}
		id := uint64(stored.Public.Output.FileID)
		ids = append(ids, id)
		args, _ := json.Marshal(map[string]any{"file_id": stored.Public.Output.FileID, "query": "ERROR"})
		read, err := f.Agents.ReadToolOutput(f.Context, x.Ref, args)
		if err != nil || !strings.Contains(read, "ERROR: retained-tail") {
			t.Fatal("literal read", err, read)
		}
		file, err := f.Agents.GetFileContent(f.Context, f.AdminToken, id)
		if err != nil {
			t.Fatal("download", err)
		}
		content := file.Data.(*a.FileContent)
		data, err := io.ReadAll(content.Reader)
		_ = content.Reader.Close()
		if err != nil || string(data) != full {
			t.Fatal("full output changed", err)
		}
		// Completion retry must reuse the fact and never bind a second file.
		again, err := f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: full}})
		if err != nil || again.Result.Content != result.Result.Content {
			t.Fatal("completion replay", err)
		}
		var count int
		if err = f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_file WHERE created_by_tool_call_id=? AND purpose='tool_output'", uint64(call.ID)); err != nil || count != 1 {
			t.Fatal("duplicate retention", count, err)
		}
	}
	originalTokens := f.Agents.Tokens
	f.Agents.Tokens = outputPressureCounter{high: (x.Model.ContextWindow - x.Model.MaxOutputTokens) * 9 / 10}
	t.Cleanup(func() { f.Agents.Tokens = originalTokens })
	pruned, err := f.Agents.PrepareStep(f.Context, x, 2)
	if err != nil || len(pruned.Manifest.ToolOutputPrunes) != 1 {
		t.Fatal("prune before summary", err, len(pruned.Manifest.ToolOutputPrunes))
	}
	runtimePreparedAttempt(t, f, x, pruned, modelcore.Message{Role: "assistant", Content: "verified diagnostic"})
	replayed, err := f.Agents.PrepareStep(f.Context, x, 3)
	firstHash, _ := core.ContentHash(pruned.Request.Messages)
	if len(replayed.Request.Messages) < len(pruned.Request.Messages) {
		t.Fatal("lost history")
	}
	replayHash, _ := core.ContentHash(replayed.Request.Messages[:len(pruned.Request.Messages)])
	if err != nil || firstHash != replayHash {
		t.Fatal("replay/cache prefix changed", err)
	}
	var count int
	if err = f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_event WHERE session_id=? AND event_type='tool/output_pruned'", session.Configuration.ID); err != nil || count != 1 {
		t.Fatal("pruning repeated", count, err)
	}
	if err = f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_artifact WHERE content_session_id=?", session.Configuration.ID); err != nil || count != 0 {
		t.Fatal("output became deliverable", err)
	}
	f.Agents.Tokens = originalTokens
	runtimePreparedAttempt(t, f, x, replayed, modelcore.Message{Role: "assistant", Content: "verified replay"})
	runtimeEnd(t, f, x)
	other := runtimeSession(t, f, agent)
	otherRun := runtimeClaim(t, f, other.Configuration.ID, "cannot read another session")
	args, _ := json.Marshal(map[string]any{"file_id": core.ID(ids[0])})
	if _, err = f.Agents.ReadToolOutput(f.Context, otherRun.Ref, args); err == nil {
		t.Fatal("cross-session output access")
	}
	runtimeAttempt(t, f, otherRun, 1, modelcore.Message{Role: "assistant", Content: "done"})
	runtimeEnd(t, f, otherRun)
	// New turn/reloaded events can still recover the original after pruning.
	x = runtimeClaim(t, f, session.Configuration.ID, "read after reload")
	if text, e := f.Agents.ReadToolOutput(f.Context, x.Ref, args); e != nil || !strings.Contains(text, "BEGIN") {
		t.Fatal("reload read", e)
	}
	runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", Content: "reloaded"})
	runtimeEnd(t, f, x)
	if err = f.Agents.ProcessFileMaintenance(f.Context, 1000); err != nil {
		t.Fatal(err)
	}
	var state string
	if err = f.Store.db.GetContext(f.Context, &state, "SELECT state FROM agent_file WHERE id=?", ids[0]); err != nil || state != "bound" {
		t.Fatal("maintenance removed retained history", err)
	}
	// An interrupted writer leaves a separate staged file, not a damaged result.
	var orphan *a.FileRow
	var lease *a.ResourceReferenceRow
	err = f.Store.Transact(f.Context, func(tx identity.Tx) error {
		st, e := a.StateFor(tx)
		if e != nil {
			return e
		}
		original, e := st.File(ids[0], false)
		if e != nil {
			return e
		}
		copyRow := *original
		orphan = &copyRow
		expired := time.Now().Add(-time.Hour)
		orphan.ID, orphan.StorageKey, orphan.WriterToken = 0, a.NewStorageKey(), a.NewStorageKey()
		orphan.State, orphan.BoundAt, orphan.ExpiresAt = "staged", nil, &expired
		if e = st.InsertFile(orphan); e != nil {
			return e
		}
		lease = &a.ResourceReferenceRow{HolderKind: "download", HolderID: a.NewStorageKey(), ResourceKind: "file", ResourceID: orphan.ID, State: "active", ExecutorEpoch: f.Agents.Epoch, FenceVersion: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
		return st.InsertResourceReference(lease)
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Agents.Files.Write(f.Context, orphan.StorageKey, strings.NewReader(full), core.ToolOutputMaxBytes); err != nil {
		t.Fatal(err)
	}
	if err = f.Agents.ProcessFileMaintenance(f.Context, 1000); err != nil {
		t.Fatal(err)
	}
	if err = f.Store.db.GetContext(f.Context, &state, "SELECT state FROM agent_file WHERE id=?", orphan.ID); err != nil || state != "staged" {
		t.Fatal("active writer reclaimed", state, err)
	}
	if _, err = f.Store.db.ExecContext(f.Context, "UPDATE agent_resource_reference SET executor_epoch='terminated-output-writer' WHERE id=?", lease.ID); err != nil {
		t.Fatal(err)
	}
	if err = f.Agents.ProcessFileMaintenance(f.Context, 1000); err != nil {
		t.Fatal(err)
	}
	if err = f.Store.db.GetContext(f.Context, &state, "SELECT state FROM agent_file WHERE id=?", orphan.ID); err != nil || state != "deleted" {
		t.Fatal("expired staging not reclaimed", state, err)
	}
	// Retention is best effort; loss of storage must not relabel a real tool effect.
	x = runtimeClaim(t, f, session.Configuration.ID, "storage unavailable")
	call := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "fallback", Name: "echo", Arguments: `{}`}}}).Calls[0]
	if _, err = f.Agents.PrepareDispatch(f.Context, x.Ref, call.ID); err != nil {
		t.Fatal(err)
	}
	files := f.Agents.Files
	f.Agents.Files = nil
	yes := true
	result, e := f.Agents.CompleteTool(context.Background(), x.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: full}})
	f.Agents.Files = files
	if e != nil || result.Result.Status != "succeeded" || !strings.Contains(result.Result.Content, "retention unavailable") || !strings.Contains(result.Result.Content, "retained-tail") {
		t.Fatal("storage failure changed physical outcome", e)
	}
	runtimeAttempt(t, f, x, 2, modelcore.Message{Role: "assistant", Content: "handled unavailable retention"})
	runtimeEnd(t, f, x)
}
