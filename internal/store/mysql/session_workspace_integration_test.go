package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type sessionUploadProvider struct {
	*artifactMemoryProvider
	stats, listings int
}

type sessionUploadFactory struct{ provider *sessionUploadProvider }

func (f sessionUploadFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

func (p *sessionUploadProvider) StatFile(ctx context.Context, ref sb.ResourceRef, name string) (sb.FileInfo, error) {
	p.stats++
	return p.artifactMemoryProvider.StatFile(ctx, ref, name)
}

func (p *sessionUploadProvider) ListFiles(ctx context.Context, ref sb.ResourceRef, name string) ([]sb.FileInfo, error) {
	p.listings++
	return p.artifactMemoryProvider.ListFiles(ctx, ref, name)
}

func (p *sessionUploadProvider) calls() int { return p.stats + p.listings + p.requests }

func testSessionWorkspaceUpload(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService, remote *sandboxMemoryProvider) {
	ctx, token := f.Context, f.AdminToken
	agent := runtimeTestAgent(t, f)
	session := runtimeSession(t, f, agent.ID)
	id := session.Configuration.ID
	key := cryptox.ID()
	_, err := svc.UploadSessionWorkspaceFile(ctx, token, id, key, "sales.csv", strings.NewReader("a,b"))
	modelsExpectCode(t, err, "WORKSPACE_PREPARATION_REQUIRED")

	var surfaceBefore uint64
	const surfaceQuery = "SELECT surface_revision FROM agent_session WHERE id=?"
	if err = f.Store.db.GetContext(ctx, &surfaceBefore, surfaceQuery, id); err != nil {
		t.Fatal(err)
	}
	prepared, err := svc.PrepareSessionWorkspace(ctx, token, id)
	if err != nil || prepared.Status != 202 {
		t.Fatalf("first workspace was not queued: %+v %v", prepared, err)
	}
	var operation struct {
		ID     uint64 `json:"operation_id,string"`
		Status string `json:"status"`
	}
	data, err := json.Marshal(prepared.Data)
	if err != nil || json.Unmarshal(data, &operation) != nil || operation.ID == 0 || operation.Status != "preparing" {
		t.Fatalf("unexpected preparation result: %s %v", data, err)
	}
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	status, err := svc.GetSessionWorkspaceOperation(ctx, token, id, operation.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, err = json.Marshal(status.Data)
	if err != nil || json.Unmarshal(data, &operation) != nil || operation.Status != "succeeded" {
		t.Fatalf("workspace operation did not complete: %s %v", data, err)
	}
	var surfaceAfter uint64
	if err = f.Store.db.GetContext(ctx, &surfaceAfter, surfaceQuery, id); err != nil || surfaceAfter != surfaceBefore {
		t.Fatalf("workspace preparation changed the model surface: %d -> %d (%v)", surfaceBefore, surfaceAfter, err)
	}

	previous := svc.Factory
	defer func() { svc.Factory = previous }()
	provider := &sessionUploadProvider{artifactMemoryProvider: &artifactMemoryProvider{sandboxMemoryProvider: remote, files: map[string][]byte{}}}
	svc.Factory = sessionUploadFactory{provider}
	result, err := svc.UploadSessionWorkspaceFile(ctx, token, id, key, "sales.csv", strings.NewReader("a,b"))
	if err != nil {
		t.Fatal(err)
	}
	cwd := fmt.Sprintf("sessions/%d", id)
	assertSessionUploadPath(t, result.Data, cwd+"/sales.csv")
	bound, err := svc.GetPersonal(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	computerID := bound.Data.(a.CloudView).ID
	baseline := provider.calls()
	if _, err = svc.UploadWorkspaceFile(ctx, token, computerID, cwd, "baseline.txt", strings.NewReader("baseline")); err != nil {
		t.Fatal(err)
	}
	baseline = provider.calls() - baseline

	x := runtimeClaim(t, f, id, "inspect the workspace")
	var before, after struct {
		Revision uint64 `db:"surface_revision"`
		Seq      uint64 `db:"last_seq"`
	}
	const projectionQuery = "SELECT surface_revision,last_seq FROM agent_session WHERE id=?"
	if err = f.Store.db.GetContext(ctx, &before, projectionQuery, id); err != nil {
		t.Fatal(err)
	}
	requests := provider.calls()
	result, err = svc.UploadSessionWorkspaceFile(ctx, token, id, cryptox.ID(), "normal.txt", strings.NewReader("ordinary workspace bytes"))
	if err != nil || provider.calls()-requests != baseline || provider.listings != 0 {
		t.Fatalf("ready upload exceeded the existing native call count or was blocked by the run: %d vs %d (%v)", provider.calls()-requests, baseline, err)
	}
	assertSessionUploadPath(t, result.Data, cwd+"/normal.txt")
	if err = f.Store.db.GetContext(ctx, &after, projectionQuery, id); err != nil || before != after {
		t.Fatal("workspace upload changed the event sequence or model surface", before, after, err)
	}
	preparedStep, err := f.Agents.PrepareStep(ctx, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	userMessages := 0
	for _, message := range preparedStep.Request.Messages {
		if strings.Contains(message.Content, "normal.txt") || strings.Contains(message.Content, "ordinary workspace bytes") || len(message.Images) != 0 {
			t.Fatal("working file was projected into the model request")
		}
		if message.Role == "user" && !strings.HasPrefix(message.Content, "[Platform context: ") {
			userMessages++
			if message.Content != "inspect the workspace" {
				t.Fatalf("user message was changed by the workspace upload: %+v", message)
			}
		}
	}
	if userMessages != 1 {
		t.Fatalf("expected one user message, got %d", userMessages)
	}
	commit := runtimePreparedAttempt(t, f, x, preparedStep, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "during-upload", Name: "echo", Arguments: `{}`}}})
	if len(commit.Calls) != 1 {
		t.Fatal("missing tool call")
	}
	call := commit.Calls[0]
	permit, err := f.Agents.PrepareDispatch(ctx, x.Ref, call.ID)
	if err != nil || permit.Kind != "execute" {
		t.Fatal("dispatch", permit.Kind, err)
	}

	access, err := svc.AcquireExecutionComputer(ctx, x.Ref, uint64(call.ID), "tool_call", fmt.Sprint(call.ID))
	if err != nil {
		t.Fatal(err)
	}
	provider.files[cwd+"/sales (2).csv"] = []byte("existing numbered file")
	requests = provider.calls()
	renameKey := cryptox.ID()
	result, err = svc.UploadSessionWorkspaceFile(ctx, token, id, renameKey, "sales.csv", strings.NewReader("new data"))
	if err != nil || provider.calls()-requests != baseline+1 || provider.listings != 1 {
		t.Fatalf("conflict did not resolve with one listing while the tool was active: %d (%v)", provider.calls()-requests, err)
	}
	renamePath := cwd + "/sales (3).csv"
	assertSessionUploadPath(t, result.Data, renamePath)
	if string(provider.files[cwd+"/sales.csv"]) != "a,b" || string(provider.files[renamePath]) != "new data" {
		t.Fatal("upload overwrote the original or saved the incorrect bytes")
	}
	requests = provider.calls()
	replay, err := svc.UploadSessionWorkspaceFile(ctx, token, id, renameKey, "sales.csv", strings.NewReader("ignored replay"))
	if err != nil || !replay.Replayed || provider.calls() != requests {
		t.Fatal("workspace receipt replay performed native IO", err)
	}
	assertSessionUploadPath(t, replay.Data, renamePath)
	receipt, err := f.Agents.GetCommandReceipt(ctx, token, renameKey, "workspace.session_upload", fmt.Sprintf("session:%d", id))
	if err != nil {
		t.Fatal(err)
	}
	assertSessionUploadPath(t, receipt.Data.(a.CommandReceipt).ResponseData, renamePath)
	if err = svc.ReleaseReferences(ctx, access, json.RawMessage(`{"physical_completion_verified":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = f.Agents.CompleteTool(ctx, x.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Executed: new(true), Content: "done"}}); err != nil {
		t.Fatal(err)
	}
	runtimeEnd(t, f, x)
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
}

func assertSessionUploadPath(t *testing.T, value any, expected string) {
	t.Helper()
	var operation struct {
		Status string `json:"status"`
		Result struct {
			Path string `json:"path"`
		} `json:"result"`
	}
	data, err := json.Marshal(value)
	if err != nil || json.Unmarshal(data, &operation) != nil || operation.Status != "succeeded" || operation.Result.Path != expected {
		t.Fatalf("unexpected upload result (want %s): %s %v", expected, data, err)
	}
}
