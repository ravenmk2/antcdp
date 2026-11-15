package agents

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type nativeTestProvider struct {
	sandboxcore.Provider
	sandboxcore.Filesystem
	data     []byte
	writes   int
	searches []sandboxcore.FileInfo
	changed  bool
}

func (p *nativeTestProvider) StatFile(_ context.Context, _ sandboxcore.ResourceRef, name string) (sandboxcore.FileInfo, error) {
	if p.data == nil {
		return sandboxcore.FileInfo{}, &sandboxcore.Error{Code: "SANDBOX_FILE_NOT_FOUND"}
	}
	stamp := int64(1)
	if p.changed {
		stamp = 2
	}
	return sandboxcore.FileInfo{Path: name, Kind: "file", Size: int64(len(p.data)), ModifiedAt: time.Unix(stamp, 0)}, nil
}
func (p *nativeTestProvider) OpenFile(_ context.Context, _ sandboxcore.ResourceRef, q sandboxcore.FileRequest) (io.ReadCloser, error) {
	data := p.data
	start := min(q.Offset, int64(len(data)))
	end := int64(len(data))
	if q.Length > 0 {
		end = min(end, start+q.Length)
	}
	return io.NopCloser(bytes.NewReader(data[start:end])), nil
}
func (p *nativeTestProvider) PutFile(_ context.Context, _ sandboxcore.ResourceRef, q sandboxcore.FileRequest, r io.Reader) error {
	if q.UID != nil || q.GID != nil {
		panic("forced identity")
	}
	p.writes++
	var err error
	p.data, err = io.ReadAll(r)
	return err
}
func (p *nativeTestProvider) SearchFiles(context.Context, sandboxcore.ResourceRef, string, string) ([]sandboxcore.FileInfo, error) {
	return p.searches, nil
}

func TestNativeFilesProtectPathsAndRequireUniqueEdits(t *testing.T) {
	p := &nativeTestProvider{data: []byte("one two one")}
	a := &SandboxAccess{Provider: p}
	for _, name := range []string{".", "agents/1/skills/a/SKILL.md", "workspace/.system/key", "../outside"} {
		if _, err := runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "write", Path: name, Data: "eA==", Overwrite: true}); err == nil {
			t.Fatal("protected path", name)
		}
	}
	if _, err := runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "edit", Path: "workspace/a", Pattern: "one", Data: "eA=="}); err == nil {
		t.Fatal("ambiguous edit accepted")
	}
	if p.writes != 0 {
		t.Fatal("validation wrote bytes")
	}
	_, err := runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "edit", Path: "workspace/a", Pattern: "two", Data: base64.StdEncoding.EncodeToString([]byte("中"))})
	if err != nil || string(p.data) != "one 中 one" || p.writes != 1 {
		t.Fatal("edit", err, string(p.data))
	}
	if _, err = runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "write", Path: "workspace/a", Data: "eA=="}); err == nil || p.writes != 1 {
		t.Fatal("existing file overwritten")
	}
	if _, err = runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "write", Path: "workspace/a", Data: "eA==", Overwrite: true, Identity: strings.Repeat("f", 64)}); err == nil || p.writes != 1 {
		t.Fatal("stale identity accepted")
	}
}

func TestNativeReadRangeAndSearchScope(t *testing.T) {
	p := &nativeTestProvider{data: []byte("0123456789")}
	a := &SandboxAccess{Provider: p}
	r, err := runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "read", Path: "workspace/a", Offset: 3, Limit: 4})
	var result struct {
		Data string `json:"data_base64"`
		Next int64  `json:"next_offset"`
		More bool   `json:"has_more"`
	}
	if err != nil || json.Unmarshal(r.Result, &result) != nil || result.Data != "MzQ1Ng==" || result.Next != 7 || !result.More {
		t.Fatal("range", string(r.Result), err)
	}
	p.searches = []sandboxcore.FileInfo{{Path: "/data/workspace/a", Kind: "file", Size: 10}, {Path: "/data/workspace-other/private", Kind: "file", Size: 10}, {Path: "/data/workspace/.system/key", Kind: "file", Size: 10}, {Path: "/etc/passwd", Kind: "file", Size: 10}}
	r, err = runNativeRequest(context.Background(), a, workspacefs.Request{Operation: "glob", Path: "workspace", Pattern: "**", Limit: 10})
	if err != nil || strings.Contains(string(r.Result), "private") || strings.Contains(string(r.Result), "passwd") || strings.Contains(string(r.Result), "key") || !strings.Contains(string(r.Result), "workspace/a") {
		t.Fatal("scope", string(r.Result), err)
	}
}

func TestNativeUnknownWritesAreNeverReplayed(t *testing.T) {
	s, m, a := workspaceWorkerFixture()
	m.op.DeadlineAt = time.Now().Add(time.Minute)
	calls := 0
	run := func() (workspacefs.Response, error) {
		calls++
		return workspacefs.Response{}, &sandboxcore.Error{Code: "SANDBOX_OPERATION_TIMEOUT", Unknown: true}
	}
	q := workspacefs.Request{Operation: "write", Path: "workspace/a"}
	if _, err := s.recordNativeRequest(context.Background(), a, 2, q, run); err == nil || !workspaceUnknown(err) {
		t.Fatal("unknown write became final", err)
	}
	if _, err := s.recordNativeRequest(context.Background(), a, 2, q, run); err == nil || calls != 1 {
		t.Fatal("replayed unknown write")
	}
	var observation workspaceOperationObservation
	if json.Unmarshal(m.op.Observation, &observation) != nil || len(observation.Executions) != 1 || observation.Executions[0].Backend != nativeFilesystemVersion {
		t.Fatal("missing native durable intent")
	}
	p := &workspaceRecoveryProvider{state: "ready"}
	s.Factory = workspaceRecoveryFactory{p}
	claim := &workspaceClaim{op: &m.op, access: a, recovery: true, observation: observation}
	if err := s.recoverWorkspaceOperation(context.Background(), claim); err != nil || m.op.Status != "outcome_unknown" {
		t.Fatal("unconfirmed mutation released", err)
	}
	p.state = "absent"
	if err := s.recoverWorkspaceOperation(context.Background(), claim); err != nil || m.op.FinishedAt == nil || p.execs != 0 {
		t.Fatal("absent resource not reconciled", err)
	}
}

func TestNativeInterruptedReadReleasesWithoutRemoteExecution(t *testing.T) {
	s, m, a := workspaceWorkerFixture()
	p := &workspaceRecoveryProvider{state: "ready"}
	s.Factory = workspaceRecoveryFactory{p}
	claim := &workspaceClaim{op: &m.op, access: a, recovery: true, observation: workspaceOperationObservation{Executions: []workspaceExecution{{Backend: nativeFilesystemVersion, State: "dispatching", Request: workspacefs.Request{Operation: "download"}}}}}
	if err := s.recoverWorkspaceOperation(context.Background(), claim); err != nil || m.op.FinishedAt == nil || p.execs != 0 {
		t.Fatal("read recovery", err)
	}
}
