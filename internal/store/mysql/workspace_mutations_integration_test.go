package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type synchronousFileProvider struct {
	*artifactMemoryProvider
	started chan struct{}
	release chan struct{}
}

func (p *synchronousFileProvider) MakeDirectory(ctx context.Context, ref sb.ResourceRef, name string, mode int) error {
	if p.started != nil {
		close(p.started)
		select {
		case <-p.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return p.artifactMemoryProvider.MakeDirectory(ctx, ref, name, mode)
}

type synchronousFileFactory struct{ provider *synchronousFileProvider }

func (f synchronousFileFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

func testWorkspaceUpload(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService, id uint64, sandbox *sandboxMemoryProvider) {
	t.Helper()
	previous := svc.Factory
	defer func() { svc.Factory = previous }()
	provider := &synchronousFileProvider{artifactMemoryProvider: &artifactMemoryProvider{
		sandboxMemoryProvider: sandbox,
		files:                 map[string][]byte{"reports": nil},
	}}
	svc.Factory = synchronousFileFactory{provider}
	const filename = "测试报告.txt"
	result, err := svc.UploadWorkspaceFile(f.Context, f.AdminToken, id, "reports", filename, strings.NewReader("ready"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != 201 || string(provider.files["reports/"+filename]) != "ready" {
		t.Fatalf("upload did not preserve the filename and content: %+v", result)
	}
	_, err = svc.UploadWorkspaceFile(f.Context, f.AdminToken, id, "reports", filename, strings.NewReader("replacement"))
	modelsExpectCode(t, err, "WORKSPACE_PATH_EXISTS")
	_, err = svc.UploadWorkspaceFile(f.Context, f.AdminToken, id, "reports", "partial.txt", io.MultiReader(strings.NewReader("partial"), iotest.ErrReader(errors.New("upload interrupted"))))
	modelsExpectCode(t, err, "VALIDATION_FAILED")
	if string(provider.files["reports/"+filename]) != "ready" || len(provider.files) != 3 {
		t.Fatal("a failed upload changed the existing file or left a staged file", provider.files)
	}
}

func testSynchronousWorkspaceMutations(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService, id uint64, sandbox *sandboxMemoryProvider) {
	t.Helper()
	previous := svc.Factory
	defer func() { svc.Factory = previous }()
	p := &synchronousFileProvider{artifactMemoryProvider: &artifactMemoryProvider{sandboxMemoryProvider: sandbox, files: map[string][]byte{}}, started: make(chan struct{}), release: make(chan struct{})}
	svc.Factory = synchronousFileFactory{p}
	ctx, cancel := context.WithTimeout(f.Context, 30*time.Second)
	defer cancel()
	type response struct {
		out *a.Result
		err error
	}
	finished := make(chan response, 1)
	key := cryptox.ID()
	write := a.WorkspaceDirectoryWrite{Path: "sync-folder"}
	go func() {
		out, err := svc.CreateWorkspaceDirectory(ctx, f.AdminToken, id, key, write)
		finished <- response{out, err}
	}()
	select {
	case <-p.started:
	case early := <-finished:
		t.Fatalf("request returned before physical execution: %+v", early)
	case <-ctx.Done():
		t.Fatal("request never dispatched directory creation")
	}
	// The transaction has committed, but the synchronous request must still wait.
	select {
	case early := <-finished:
		t.Fatalf("request returned before completion: %+v", early)
	default:
	}
	replay, err := svc.CreateWorkspaceDirectory(ctx, f.AdminToken, id, key, write)
	if err != nil || replay.Status != 202 || !replay.Replayed {
		t.Fatalf("in-flight replay: %+v %v", replay, err)
	}
	_, err = svc.CreateWorkspaceDirectory(ctx, f.AdminToken, id, cryptox.ID(), a.WorkspaceDirectoryWrite{Path: "competing"})
	modelsExpectCode(t, err, "CLOUD_COMPUTER_BUSY")
	close(p.release)
	result := <-finished
	if result.err != nil {
		t.Fatal(result.err)
	}
	assertWorkspaceResponse(t, result.out, "succeeded", "")
	p.started = nil
	requests := p.requests
	replay, err = svc.CreateWorkspaceDirectory(ctx, f.AdminToken, id, key, write)
	if err != nil || !replay.Replayed || p.requests != requests {
		t.Fatal("completed directory replay performed IO", err)
	}
	assertWorkspaceResponse(t, replay, "succeeded", "")
	receipt, err := f.Agents.GetCommandReceipt(ctx, f.AdminToken, key, "workspace.mkdir", fmt.Sprintf("workspace:%d", id))
	if err != nil {
		t.Fatal(err)
	}
	value := receipt.Data.(a.CommandReceipt)
	assertWorkspaceResponse(t, &a.Result{Status: value.ResponseStatus, Data: value.ResponseData}, "succeeded", "")

	p.files["first.txt"], p.files["second.txt"] = []byte("first"), []byte("second")
	listing, err := svc.ListWorkspaceEntries(ctx, f.AdminToken, id, a.WorkspaceEntryQuery{})
	if err != nil {
		t.Fatal(err)
	}
	tokens := map[string]string{}
	for _, entry := range listing.Data.([]a.WorkspaceEntry) {
		tokens[entry.Path] = entry.EntryToken
	}
	p.files["second.txt"] = []byte("changed since listing")
	current, err := svc.GetPersonal(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	removal := a.WorkspaceRemovalWrite{Items: []a.WorkspaceRemovalItem{{Path: "first.txt", EntryToken: tokens["first.txt"]}, {Path: "second.txt", EntryToken: tokens["second.txt"]}}}
	removeKey := cryptox.ID()
	removed, err := svc.RemoveWorkspaceFiles(ctx, f.AdminToken, id, current.Tag, removeKey, removal)
	if err != nil {
		t.Fatal(err)
	}
	assertWorkspaceResponse(t, removed, "failed", "WORKSPACE_ENTRY_CHANGED")
	if _, exists := p.files["first.txt"]; exists || string(p.files["second.txt"]) != "changed since listing" {
		t.Fatal("partial deletion lost file identity protection")
	}
	requests = p.requests
	replay, err = svc.RemoveWorkspaceFiles(ctx, f.AdminToken, id, current.Tag, removeKey, removal)
	if err != nil || !replay.Replayed || requests != p.requests {
		t.Fatal("partial deletion replay performed IO", err)
	}
	assertWorkspaceResponse(t, replay, "failed", "WORKSPACE_ENTRY_CHANGED")
	listing, err = svc.ListWorkspaceEntries(ctx, f.AdminToken, id, a.WorkspaceEntryQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range listing.Data.([]a.WorkspaceEntry) {
		tokens[entry.Path] = entry.EntryToken
	}
	current, err = svc.GetPersonal(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	removed, err = svc.RemoveWorkspaceFiles(ctx, f.AdminToken, id, current.Tag, cryptox.ID(), a.WorkspaceRemovalWrite{Items: []a.WorkspaceRemovalItem{{Path: "sync-folder", EntryToken: tokens["sync-folder"]}}, Recursive: true})
	if err != nil {
		t.Fatal(err)
	}
	assertWorkspaceResponse(t, removed, "succeeded", "")
	if _, exists := p.files["sync-folder"]; exists {
		t.Fatal("delete returned before removing the directory")
	}
	current, err = svc.GetPersonal(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	computer := current.Data.(a.CloudView)
	if computer.PendingTransfers != 0 || computer.UnknownExecutions != 0 {
		t.Fatal("completed file mutations retained occupancy")
	}
}

func assertWorkspaceResponse(t *testing.T, out *a.Result, status, code string) {
	t.Helper()
	data, err := json.Marshal(out.Data)
	if err != nil {
		t.Fatal(err)
	}
	var operation struct {
		Status    string `json:"status"`
		ErrorCode string `json:"error_code"`
		Result    struct {
			Paths []string `json:"affected_paths"`
		} `json:"result"`
	}
	if err = json.Unmarshal(data, &operation); err != nil {
		t.Fatal(err)
	}
	if out.Status != 200 || operation.Status != status || operation.ErrorCode != code {
		t.Fatalf("unexpected synchronous result: %d %s", out.Status, data)
	}
	if status == "failed" && (len(operation.Result.Paths) != 1 || operation.Result.Paths[0] != "first.txt") {
		t.Fatalf("lost partial mutation result: %s", data)
	}
}
