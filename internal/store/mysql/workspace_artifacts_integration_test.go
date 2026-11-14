package mysql

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"strconv"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"workspace_artifact_transfers", workspaceArtifactTransfers})
}

type artifactMemoryProvider struct {
	*sandboxMemoryProvider
	files         map[string][]byte
	transfers     map[string][]byte
	results       map[string][]byte
	requests      int
	unknownImport bool
}

func (p *artifactMemoryProvider) Exec(ctx context.Context, ref sb.ResourceRef, spec sb.ExecSpec, callbacks sb.ExecCallbacks) (sb.ExecResult, error) {
	if len(spec.Argv) != 2 || spec.Argv[0] != workspacefs.HelperPath || spec.UID == nil || *spec.UID != 0 {
		return sb.ExecResult{}, fmt.Errorf("invalid trusted helper call")
	}
	q, e := workspacefs.Decode(spec.Argv[1])
	if e != nil {
		return sb.ExecResult{}, e
	}
	p.requests++
	h := sb.ExecutionHandle{Resource: ref, ID: fmt.Sprintf("helper-%d", p.requests)}
	if e = callbacks.Started(ctx, h); e != nil {
		return sb.ExecResult{Handle: &h}, e
	}
	var result any = map[string]any{}
	response := workspacefs.Response{Version: workspacefs.Version, OK: true}
	switch q.Operation {
	case "transfer_begin":
		p.transfers[q.Token] = nil
	case "transfer_cleanup":
		delete(p.transfers, q.Token)
	case "export":
		content, ok := p.files[q.Path]
		if !ok {
			response.OK = false
			response.Code = "WORKSPACE_PATH_NOT_FOUND"
			break
		}
		p.transfers[q.Token] = append([]byte(nil), content...)
		sum := sha256.Sum256(content)
		result = map[string]any{"transfer_path": workspacefs.TransferDirectory + "/" + q.Token + "/payload", "source_path": q.Path, "size_bytes": strconv.Itoa(len(content)), "sha256": hex.EncodeToString(sum[:]), "identity": strings.Repeat("a", 64)}
	case "import":
		if p.unknownImport {
			p.unknownImport = false
			return sb.ExecResult{Handle: &h}, &sb.Error{Code: "SANDBOX_STREAM_INTERRUPTED", Unknown: true}
		}
		if _, exists := p.files[q.Path]; exists {
			response.OK = false
			response.Code = "WORKSPACE_PATH_EXISTS"
			break
		}
		content := p.transfers[q.Token]
		sum := sha256.Sum256(content)
		if hex.EncodeToString(sum[:]) != q.ExpectedHash {
			return sb.ExecResult{}, fmt.Errorf("test import hash mismatch")
		}
		p.files[q.Path] = append([]byte(nil), content...)
		response.Changed = true
		result = map[string]any{"path": q.Path, "sha256": q.ExpectedHash, "size_bytes": strconv.Itoa(len(content))}
	default:
		return sb.ExecResult{}, fmt.Errorf("unsupported fixture helper %s", q.Operation)
	}
	response.Result, _ = json.Marshal(result)
	p.results[h.ID], _ = json.Marshal(response)
	return sb.ExecResult{Handle: &h, Running: true}, nil
}
func (p *artifactMemoryProvider) InspectExecution(_ context.Context, h sb.ExecutionHandle) (sb.ExecResult, error) {
	if _, ok := p.results[h.ID]; !ok {
		return sb.ExecResult{}, &sb.Error{Code: "SANDBOX_EXECUTION_UNCONFIRMED", Unknown: true}
	}
	code := int32(0)
	return sb.ExecResult{Handle: &h, ExitCode: &code}, nil
}
func (p *artifactMemoryProvider) ReadExecutionOutput(_ context.Context, h sb.ExecutionHandle, cursor int64, maxBytes int) (sb.ExecutionOutput, error) {
	data := p.results[h.ID]
	start := min(cursor, int64(len(data)))
	end := min(start+int64(maxBytes), int64(len(data)))
	return sb.ExecutionOutput{Text: string(data[start:end]), Cursor: end, Truncated: end < int64(len(data))}, nil
}
func (p *artifactMemoryProvider) OpenFile(_ context.Context, _ sb.ResourceRef, q sb.FileRequest) (io.ReadCloser, error) {
	token := strings.TrimSuffix(strings.TrimPrefix(q.Path, workspacefs.TransferDirectory+"/"), "/payload")
	data, ok := p.transfers[token]
	if !ok {
		return nil, fmt.Errorf("transfer missing")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}
func (p *artifactMemoryProvider) PutFile(_ context.Context, _ sb.ResourceRef, q sb.FileRequest, source io.Reader) error {
	token := strings.TrimSuffix(strings.TrimPrefix(q.Path, workspacefs.TransferDirectory+"/"), "/payload")
	if _, ok := p.transfers[token]; !ok {
		return fmt.Errorf("transfer unprepared")
	}
	data, e := io.ReadAll(io.LimitReader(source, q.MaxBytes+1))
	if e != nil {
		return e
	}
	if int64(len(data)) > q.MaxBytes {
		return fmt.Errorf("transfer too large")
	}
	p.transfers[token] = data
	return nil
}

type artifactMemoryFactory struct{ remote *artifactMemoryProvider }

func (f artifactMemoryFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.remote, nil
}

func workspaceArtifactTransfers(t *testing.T, f *agentIntegrationFixture) {
	ctx, host := f.Context, f.Agents
	oldCatalog, oldEpoch, oldSandboxes := host.Catalog, host.Epoch, host.Sandboxes
	t.Cleanup(func() { host.Catalog, host.Epoch, host.Sandboxes = oldCatalog, oldEpoch, oldSandboxes })
	host.Epoch = "artifact-transfer-test"
	host.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		class := "sandbox"
		if key == "delegate" {
			class = "child"
		}
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: class, RequiresSandbox: class == "sandbox", ParallelSafe: false, SupportedPolicies: []string{"allow", "deny"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, Description: "File transfer fixture", InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}, AuthorizeTool: func(context.Context, identity.Tx, core.ExecutionContext, a.ToolDescriptor, json.RawMessage, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{}`), nil
	}}
	remote := &artifactMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, files: map[string][]byte{}, transfers: map[string][]byte{}, results: map[string][]byte{}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, Cipher: f.Models.Cipher, InstallationID: func() (string, error) { return f.Installation, nil }, Factory: artifactMemoryFactory{remote}, PrepareWorkspace: func(context.Context, *a.SandboxAccess, uint64, uint64) error { return nil }, VerifyEnvironment: func(context.Context, *a.SandboxAccess) (a.SandboxCapabilities, []a.DiagnosticCheck, error) {
		return a.SandboxCapabilities{Execution: "supported", FileTransfer: "supported"}, []a.DiagnosticCheck{{Name: "fixture", Status: "succeeded"}}, nil
	}}
	svc.EndpointTargets = func(string) ([]string, error) { return []string{"192.0.2.19"}, nil }
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	agent := sandboxServiceAgent(t, f, "per_run")
	bindings, e := host.GetToolBindings(ctx, f.AdminToken, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = host.PutToolBindings(ctx, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{{ToolKey: "present", Policy: "allow", Constraints: json.RawMessage(`{}`)}, {ToolKey: "import_file", Policy: "allow", Constraints: json.RawMessage(`{}`)}, {ToolKey: "delegate", Policy: "allow", Constraints: json.RawMessage(`{}`)}}}); e != nil {
		t.Fatal(e)
	}
	session := runtimeSession(t, f, agent.ID)
	upload, e := host.UploadAttachment(ctx, f.AdminToken, session.Configuration.ID, cryptox.ID(), "source.txt", strings.NewReader("immutable source"))
	if e != nil {
		t.Fatal(e)
	}
	attachment := upload.Data.(a.AttachmentView)
	detail, e := host.GetSession(ctx, f.AdminToken, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	accepted, e := host.SubmitInput(ctx, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "导入选定附件并保存成果"}}, Files: []core.FileRef{{Kind: "attachment", ID: core.ID(attachment.ID)}}, ExpectedHash: detail.Data.(a.SessionDetail).Selection.Hash})
	if e != nil {
		t.Fatal(e)
	}
	claimed, e := claimCloudRoot(t, f, svc, core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session.Configuration.ID), InputID: core.ID(accepted.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch})
	if e != nil || !claimed.Claimed {
		t.Fatal(e)
	}
	x := claimed.Execution
	binding, e := svc.Acquire(ctx, x)
	if e != nil || binding == nil {
		t.Fatal(e)
	}
	if _, e = host.ActivateBinding(ctx, x.Ref, *binding); e != nil {
		t.Fatal(e)
	}
	x.Binding = binding
	beforeImage := remote.requests
	_, e = svc.ReadImage(ctx, x.Ref, 0, a.ReadImageRequest{Path: "/data/image.png"})
	modelsExpectCode(t, e, "MODEL_CAPABILITY_UNSUPPORTED")
	if remote.requests != beforeImage {
		t.Fatal("unsupported model performed image IO")
	}
	w := a.ImportFileRequest{Source: core.FileRef{Kind: "attachment", ID: core.ID(attachment.ID)}, Destination: "source.txt"}
	args, _ := json.Marshal(w)
	call := commandDeclare(t, f, x, 1, "import_file", string(args))
	imported, e := svc.ImportFile(ctx, x.Ref, uint64(call.ID), w)
	if e != nil || imported.Committed == nil {
		t.Fatal("import commit", e)
	}
	if e = imported.Committed.ValidateTool(call.ID, x.Ref.SessionID); e != nil {
		t.Fatal(e)
	}
	name := strings.TrimPrefix(binding.CWD, "/data/") + "/source.txt"
	if string(remote.files[name]) != "immutable source" {
		t.Fatal("import bytes changed")
	}
	before := remote.requests
	if _, e = svc.ImportFile(ctx, x.Ref, uint64(call.ID), w); e != nil || remote.requests != before {
		t.Fatal("import replay performed IO", e)
	}
	remote.files[strings.TrimPrefix(binding.CWD, "/data/")+"/report.md"] = []byte("retained report")
	present := a.PresentRequest{Files: []a.PresentFile{{Path: "report.md", Description: "持久成果"}, {Path: "source.txt"}}}
	args, _ = json.Marshal(present)
	presentCall := commandDeclare(t, f, x, 2, "present", string(args))
	saved, e := svc.Present(ctx, x.Ref, uint64(presentCall.ID), present)
	if e != nil || saved.Committed == nil || len(saved.Committed.ArtifactIDs) != 2 {
		t.Fatal("present atomic commit", e)
	}
	if e = saved.Committed.ValidateTool(presentCall.ID, x.Ref.SessionID); e != nil {
		t.Fatal(e)
	}
	before = remote.requests
	if _, e = svc.Present(ctx, x.Ref, uint64(presentCall.ID), present); e != nil || remote.requests != before {
		t.Fatal("present copied twice", e)
	}
	var results int
	if e = f.Store.db.GetContext(ctx, &results, "SELECT COUNT(*) FROM agent_event WHERE session_id=? AND event_type='tool/result'", session.Configuration.ID); e != nil || results != 2 {
		t.Fatal("unique tool results", results, e)
	}
	artifactResult, e := host.GetArtifact(ctx, f.AdminToken, uint64(saved.Committed.ArtifactIDs[0]))
	if e != nil {
		t.Fatal(e)
	}
	artifact := artifactResult.Data.(a.ArtifactView)
	delete(remote.files, strings.TrimPrefix(binding.CWD, "/data/")+"/report.md")
	content, e := host.GetFileContent(ctx, f.AdminToken, artifact.FileID)
	if e != nil {
		t.Fatal(e)
	}
	file := content.Data.(*a.FileContent)
	data, e := io.ReadAll(file.Reader)
	closeErr := file.Reader.Close()
	if e != nil || closeErr != nil || string(data) != "retained report" {
		t.Fatal("artifact depended on mutable workspace", e, closeErr)
	}
	// A file visible in this Session but not selected by this root is not an
	// import authority. The just-created artifact also requires explicit input.
	unselected := a.ImportFileRequest{Source: core.FileRef{Kind: "artifact", ID: core.ID(artifact.ID)}, Destination: "unselected.txt"}
	args, _ = json.Marshal(unselected)
	badCall := commandDeclare(t, f, x, 3, "import_file", string(args))
	before = remote.requests
	_, e = svc.ImportFile(ctx, x.Ref, uint64(badCall.ID), unselected)
	modelsExpectCode(t, e, "NOT_FOUND")
	if remote.requests != before {
		t.Fatal("unselected source touched remote")
	}
	no := false
	if _, e = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: badCall, Observation: core.DispatchObservation{Status: "failed", Executed: &no, Content: "not selected"}}); e != nil {
		t.Fatal(e)
	}
	// Child publication belongs to the root content domain while its unique
	// tool result belongs to the child's independent event sequence.
	delegated := commandDeclare(t, f, x, 4, "delegate", `{"task":"生成子任务成果","file_refs":[]}`)
	child, e := host.CreateChild(ctx, core.ChildRequest{Parent: delegated, Content: []core.TextBlock{{Type: "text", Text: "生成子任务成果"}}})
	if e != nil || !child.Created {
		t.Fatal("create artifact child", e)
	}
	child.Execution.Binding = binding
	remote.files[strings.TrimPrefix(binding.CWD, "/data/")+"/child.txt"] = []byte("child retained")
	childRequest := a.PresentRequest{Files: []a.PresentFile{{Path: "child.txt"}}}
	args, _ = json.Marshal(childRequest)
	childCall := commandDeclare(t, f, child.Execution, 1, "present", string(args))
	childSaved, e := svc.Present(ctx, child.Execution.Ref, uint64(childCall.ID), childRequest)
	if e != nil || childSaved.Committed == nil || len(childSaved.Committed.Ranges) != 2 || childSaved.Committed.ContentSessionID != x.Ref.SessionID || childSaved.Committed.ToolResultSessionID != child.Execution.Ref.SessionID {
		t.Fatal("child cross-session receipt", e)
	}
	if e = childSaved.Committed.ValidateTool(childCall.ID, child.Execution.Ref.SessionID); e != nil {
		t.Fatal(e)
	}
	if _, e = host.EndChild(ctx, child.Execution.Ref, core.ChildEnd{End: core.RunEnd{Status: core.Succeeded}}); e != nil {
		t.Fatal(e)
	}
	// An existing destination must not be overwritten, even with equal hashes.
	args, _ = json.Marshal(w)
	duplicate := commandDeclare(t, f, x, 5, "import_file", string(args))
	failed, e := svc.ImportFile(ctx, x.Ref, uint64(duplicate.ID), w)
	if e == nil {
		t.Fatal("existing import target replaced")
	}
	if string(remote.files[name]) != "immutable source" {
		t.Fatal("existing target changed")
	}
	if _, e = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: duplicate, Observation: failed}); e != nil {
		t.Fatal(e)
	}
	// A lost helper response with a durable handle is inspected, never sent
	// again. Its source and workspace references survive until physical proof.
	w.Destination = "unknown.txt"
	args, _ = json.Marshal(w)
	uncertainCall := commandDeclare(t, f, x, 6, "import_file", string(args))
	remote.unknownImport = true
	uncertain, e := svc.ImportFile(ctx, x.Ref, uint64(uncertainCall.ID), w)
	if e == nil || uncertain.Status != "outcome_unknown" {
		t.Fatal("lost import response treated as known", e)
	}
	if _, e = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: uncertainCall, Observation: uncertain}); e != nil {
		t.Fatal(e)
	}
	runtimeEnd(t, f, x)
	before = remote.requests
	if e = svc.ProcessFileOperations(ctx, 25); e != nil {
		t.Fatal("file reconciliation", e)
	}
	if remote.requests != before {
		t.Fatal("uncertain import replayed")
	}
	var held int
	if e = f.Store.db.GetContext(ctx, &held, "SELECT COUNT(*) FROM agent_resource_reference r JOIN agent_file_operation o ON r.holder_kind='file_operation' AND r.holder_id=CAST(o.id AS CHAR) WHERE o.tool_call_id=? AND r.state<>'released'", uint64(uncertainCall.ID)); e != nil || held == 0 {
		t.Fatal("uncertain import released references", e)
	}
	if _, e = f.Store.db.ExecContext(ctx, "UPDATE cloud_computer SET state='deleted',deleted_at=UTC_TIMESTAMP(3) WHERE id=?", uint64(binding.ComputerID)); e != nil {
		t.Fatal(e)
	}
	if e = svc.ProcessFileOperations(ctx, 25); e != nil {
		t.Fatal("terminated transfer reconciliation", e)
	}
	if e = f.Store.db.GetContext(ctx, &held, "SELECT COUNT(*) FROM agent_resource_reference r JOIN agent_file_operation o ON r.holder_kind='file_operation' AND r.holder_id=CAST(o.id AS CHAR) WHERE o.tool_call_id=? AND r.state<>'released'", uint64(uncertainCall.ID)); e != nil || held != 0 {
		t.Fatal("physical termination did not release references", e)
	}
	current, e := host.GetArtifact(ctx, f.AdminToken, artifact.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = host.DeleteArtifact(ctx, f.AdminToken, artifact.ID, current.Tag, cryptox.ID()); e != nil {
		t.Fatal(e)
	}
	if e = host.ProcessFileMaintenance(ctx, 100); e != nil {
		t.Fatal(e)
	}
	var fileState string
	if e = f.Store.db.GetContext(ctx, &fileState, "SELECT state FROM agent_file WHERE id=?", artifact.FileID); e != nil || fileState != "deleted" {
		t.Fatal("deleted artifact bytes never reclaimed", fileState, e)
	}
	var stillBound int
	if e = f.Store.db.GetContext(ctx, &stillBound, "SELECT COUNT(*) FROM agent_artifact a JOIN agent_file f ON f.id=a.file_id WHERE a.tool_call_id=? AND a.deleted_at IS NULL AND f.state='bound'", uint64(childCall.ID)); e != nil || stillBound != 1 {
		t.Fatal("cleanup touched retained child artifact", e)
	}
	t.Run("controlled_tool_image_history", func(t *testing.T) { workspaceToolImage(t, f, svc, remote) })
}

func workspaceToolImage(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService, remote *artifactMemoryProvider) {
	t.Helper()
	ctx, host := f.Context, f.Agents
	var modelID uint64
	var capabilities json.RawMessage
	if e := f.Store.db.QueryRowxContext(ctx, "SELECT id,capabilities FROM model_definition WHERE model_id='agent-test' LIMIT 1").Scan(&modelID, &capabilities); e != nil {
		t.Fatal(e)
	}
	if _, e := f.Store.db.ExecContext(ctx, "UPDATE model_definition SET capabilities=JSON_SET(capabilities,'$.image_input','supported') WHERE id=?", modelID); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		_, e := f.Store.db.ExecContext(ctx, "UPDATE model_definition SET capabilities=? WHERE id=?", string(capabilities), modelID)
		if e != nil {
			t.Error(e)
		}
	})
	agent := sandboxServiceAgent(t, f, "per_run")
	bindings, e := host.GetToolBindings(ctx, f.AdminToken, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = host.PutToolBindings(ctx, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{{ToolKey: "read_image", Policy: "allow", Constraints: json.RawMessage(`{}`)}}}); e != nil {
		t.Fatal(e)
	}
	session := runtimeSession(t, f, agent.ID)
	accepted, e := host.SubmitInput(ctx, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "查看图像"}}, ExpectedHash: session.Selection.Hash})
	if e != nil {
		t.Fatal(e)
	}
	claimed, e := claimCloudRoot(t, f, svc, core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session.Configuration.ID), InputID: core.ID(accepted.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch})
	if e != nil || !claimed.Claimed {
		t.Fatal("claim image root", e)
	}
	x := claimed.Execution
	binding, e := svc.Acquire(ctx, x)
	if e != nil || binding == nil {
		t.Fatal("image workspace", e)
	}
	if _, e = host.ActivateBinding(ctx, x.Ref, *binding); e != nil {
		t.Fatal(e)
	}
	x.Binding = binding
	var content bytes.Buffer
	if e = png.Encode(&content, image.NewNRGBA(image.Rect(0, 0, 2, 1))); e != nil {
		t.Fatal(e)
	}
	name := "storage/fixture-image.png"
	remote.files[name] = content.Bytes()
	w := a.ReadImageRequest{Path: "/data/" + name}
	args, _ := json.Marshal(w)
	call := commandDeclare(t, f, x, 1, "read_image", string(args))
	result, e := svc.ReadImage(ctx, x.Ref, uint64(call.ID), w)
	if e != nil || result.Committed == nil || len(result.Committed.ArtifactIDs) != 0 {
		t.Fatal("image commit", e)
	}
	before := remote.requests
	if _, e = svc.ReadImage(ctx, x.Ref, uint64(call.ID), w); e != nil || remote.requests != before {
		t.Fatal("image replay copied twice", e)
	}
	var payload json.RawMessage
	if e = f.Store.db.GetContext(ctx, &payload, "SELECT payload FROM agent_event WHERE session_id=? AND seq=?", uint64(result.Committed.ToolResultSessionID), uint64(result.Committed.ToolResultSeq)); e != nil {
		t.Fatal(e)
	}
	var stored a.StoredEvent
	if json.Unmarshal(payload, &stored) != nil || stored.Message == nil || len(stored.Message.Images) != 1 || stored.Message.Images[0].Origin != "tool_image" || stored.Message.Images[0].DataBase64 != "" {
		t.Fatal("image history missing or contains bytes")
	}
	if strings.Contains(string(stored.Public), "file_id") || strings.Contains(string(stored.Public), content.String()) || strings.Contains(string(payload), base64.StdEncoding.EncodeToString(content.Bytes())) {
		t.Fatal("public image bytes or file access escaped")
	}
	var fileID uint64
	if e = f.Store.db.GetContext(ctx, &fileID, "SELECT id FROM agent_file WHERE created_by_tool_call_id=? AND purpose='tool_image' AND state='bound'", uint64(call.ID)); e != nil {
		t.Fatal(e)
	}
	if _, e = host.GetFile(ctx, f.AdminToken, fileID); e == nil {
		t.Fatal("private history image became public file")
	}
	delete(remote.files, name)
	prepared, e := host.PrepareStep(ctx, x, 2)
	if e != nil {
		t.Fatal("hydrate image without mutable source", e)
	}
	found := false
	for _, message := range prepared.Request.Messages {
		if message.ToolCallID == call.Call.ID && len(message.Images) == 1 {
			found = true
			if message.Images[0].DataBase64 != base64.StdEncoding.EncodeToString(content.Bytes()) || message.Images[0].Origin != "tool_image" {
				t.Fatal("wrong hydrated image")
			}
		}
	}
	if !found {
		t.Fatal("tool image missing from inference surface")
	}
	var leases int
	if e = f.Store.db.GetContext(ctx, &leases, "SELECT COUNT(*) FROM agent_resource_reference WHERE resource_kind='file' AND resource_id=? AND holder_kind='download' AND state<>'released'", fileID); e != nil || leases != 0 {
		t.Fatal("image hydration leaked lease", e)
	}
	remote.files["storage/not-image.png"] = []byte("not an image")
	w.Path = "/data/storage/not-image.png"
	args, _ = json.Marshal(w)
	// This step was already opened above to inspect hydrated history. Freeze
	// that exact prepared request rather than reopening the steer boundary.
	hash, e := core.ContentHash(prepared.Request)
	if e != nil {
		t.Fatal(e)
	}
	frozen, e := host.FreezeAttempt(ctx, x.Ref, core.AttemptDraft{Step: prepared, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now().UTC(), 30, x.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}})
	if e != nil {
		t.Fatal(e)
	}
	committed, e := host.CompleteAttempt(ctx, x.Ref, core.AttemptResult{Permit: frozen.Permit, Outcome: core.AttemptOutcome{Response: modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "invalid-image", Name: "read_image", Arguments: string(args)}}}}}})
	if e != nil || committed.Failure != nil || len(committed.Calls) != 1 {
		t.Fatal("declare invalid image", e, committed.Failure)
	}
	invalid := committed.Calls[0]
	permit, e := host.PrepareDispatch(ctx, x.Ref, invalid.ID)
	if e != nil || permit.Kind != "execute" {
		t.Fatal("dispatch invalid image", e)
	}
	failed, e := svc.ReadImage(ctx, x.Ref, uint64(invalid.ID), w)
	modelsExpectCode(t, e, "IMAGE_INVALID")
	if failed.Status != "failed" {
		t.Fatal("invalid image was unknown")
	}
	if _, e = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: invalid, Observation: failed}); e != nil {
		t.Fatal(e)
	}
	runtimeEnd(t, f, x)
	if e = svc.ProcessFileOperations(ctx, 100); e != nil {
		t.Fatal(e)
	}
	if e = host.ProcessFileMaintenance(ctx, 100); e != nil {
		t.Fatal(e)
	}
	var state string
	if e = f.Store.db.GetContext(ctx, &state, "SELECT state FROM agent_file WHERE id=?", fileID); e != nil || state != "bound" {
		t.Fatal("history image was reclaimed", state, e)
	}
}
