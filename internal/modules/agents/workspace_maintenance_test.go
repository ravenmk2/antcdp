package agents

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type workspaceWorkerMemory struct {
	identity.Store
	Repository
	StateRepository
	CloudRepository
	op       CloudOperationRow
	public   PublicOperationRow
	refs     []ResourceReferenceRow
	w        CloudComputerRow
	provider SandboxConnectionRow
	actor    identity.User
	txRuns   int
}

func (m *workspaceWorkerMemory) Transact(_ context.Context, fn func(identity.Tx) error) error {
	m.txRuns++
	return fn(workspaceWorkerTx{memory: m})
}

type workspaceWorkerTx struct {
	identity.Tx
	memory *workspaceWorkerMemory
}

func (m workspaceWorkerTx) Agents() Repository          { return m.memory }
func (m workspaceWorkerTx) AgentState() StateRepository { return m.memory }
func (m workspaceWorkerTx) CloudState() CloudRepository { return m.memory }
func (m workspaceWorkerTx) LockUsers(ids []uint64) (map[uint64]*identity.User, error) {
	return map[uint64]*identity.User{m.memory.actor.ID: &m.memory.actor}, nil
}
func (m *workspaceWorkerMemory) Computer(uint64, bool) (*CloudComputerRow, error) {
	return &m.w, nil
}
func (m *workspaceWorkerMemory) Connection(bool) (*SandboxConnectionRow, error) {
	return &m.provider, nil
}
func (m *workspaceWorkerMemory) CloudActivity(uint64) (CloudActivity, error) {
	return CloudActivity{Operations: 1}, nil
}
func (m *workspaceWorkerMemory) InsertResourceReference(ref *ResourceReferenceRow) error {
	ref.ID = uint64(len(m.refs) + 1)
	m.refs = append(m.refs, *ref)
	return nil
}
func (m *workspaceWorkerMemory) CloudOperation(uint64, bool) (*CloudOperationRow, error) {
	copy := m.op
	return &copy, nil
}
func (m *workspaceWorkerMemory) SaveCloudOperation(op *CloudOperationRow) error {
	m.op = *op
	return nil
}
func (m *workspaceWorkerMemory) HolderReferences(kind, id string, _ bool) ([]ResourceReferenceRow, error) {
	refs := []ResourceReferenceRow{}
	for _, ref := range m.refs {
		if ref.HolderKind == kind && ref.HolderID == id {
			refs = append(refs, ref)
		}
	}
	return refs, nil
}
func (m *workspaceWorkerMemory) ActiveResourceReferences(kind string, id uint64) ([]ResourceReferenceRow, error) {
	refs := []ResourceReferenceRow{}
	for _, ref := range m.refs {
		if ref.ResourceKind == kind && ref.ResourceID == id && (ref.State == "active" || ref.State == "unknown") {
			refs = append(refs, ref)
		}
	}
	return refs, nil
}
func (m *workspaceWorkerMemory) SaveResourceReference(ref *ResourceReferenceRow) error {
	for i := range m.refs {
		if m.refs[i].ID == ref.ID {
			m.refs[i] = *ref
		}
	}
	return nil
}
func (m *workspaceWorkerMemory) PublicOperation(uint64, bool) (*PublicOperationRow, error) {
	copy := m.public
	return &copy, nil
}
func (m *workspaceWorkerMemory) SavePublicOperation(op *PublicOperationRow) error {
	m.public = *op
	return nil
}

func workspaceWorkerFixture() (*CloudService, *workspaceWorkerMemory, *SandboxAccess) {
	publicID, workspaceID := uint64(3), uint64(4)
	m := &workspaceWorkerMemory{
		op:     CloudOperationRow{ID: 2, PublicOperationID: &publicID, ComputerID: workspaceID, Kind: "workspace_remove", Status: "running", ExecutorEpoch: "current", FenceVersion: 7, Observation: json.RawMessage(`{"executions":[]}`)},
		public: PublicOperationRow{ID: 3, Status: "running"},
		refs:   []ResourceReferenceRow{{ID: 1, HolderKind: "cloud_file_operation", HolderID: "2", ResourceKind: "cloud_computer", ResourceID: 4, State: "active", FenceVersion: 1}},
		w:      CloudComputerRow{ID: 4},
	}
	s := &CloudService{Epoch: "current", InstallationID: func() (string, error) { return strings.Repeat("a", 32), nil }, Host: &Service{Store: func() (identity.Store, error) { return m, nil }}}
	access := &SandboxAccess{ComputerID: 4, RuntimeGeneration: 1, HelperOperationID: 2, HelperOperationFence: 7}
	return s, m, access
}

func TestWorkspaceSettlementAtomicallyUpdatesPublicPhysicalAndReferences(t *testing.T) {
	s, m, access := workspaceWorkerFixture()
	result := map[string]any{"affected_paths": []string{"storage/first.txt"}}
	cause := httpx.E(409, "FILE_STATE_CHANGED", "changed")
	if err := s.finishWorkspaceOperation(context.Background(), 2, access, result, cause); err != nil {
		t.Fatal(err)
	}
	if m.txRuns != 1 || m.op.Status != "failed" || m.public.Status != "failed" || m.op.ErrorCode == nil || *m.op.ErrorCode != "FILE_STATE_CHANGED" || m.refs[0].State != "released" || m.public.FinishedAt == nil {
		t.Fatalf("inconsistent settlement: %+v %+v %+v", m.op, m.public, m.refs)
	}
	before := m.refs[0].FenceVersion
	if err := s.finishWorkspaceOperation(context.Background(), 2, access, result, nil); err != nil || m.refs[0].FenceVersion != before || m.public.Status != "failed" {
		t.Fatal("completion replay changed committed result")
	}
}

func TestWorkspaceStaleCallbackCannotReleaseReferences(t *testing.T) {
	s, m, access := workspaceWorkerFixture()
	m.op.FenceVersion++
	if err := s.finishWorkspaceOperation(context.Background(), 2, access, nil, nil); err == nil {
		t.Fatal("stale callback accepted")
	}
	if m.refs[0].State != "active" || m.public.Status != "running" {
		t.Fatal("stale callback altered occupancy")
	}
}

func TestWorkspaceUnknownRemainsOccupiedPastDeadline(t *testing.T) {
	s, m, access := workspaceWorkerFixture()
	m.op.DeadlineAt = time.Now().Add(-time.Hour)
	cause := httpx.E(409, "WORKSPACE_IO_OUTCOME_UNKNOWN", "unknown")
	if err := s.finishWorkspaceOperation(context.Background(), 2, access, nil, cause); err != nil {
		t.Fatal(err)
	}
	if m.op.Status != "outcome_unknown" || m.op.FinishedAt != nil || m.public.Status != "outcome_unknown" || m.refs[0].State != "unknown" {
		t.Fatal("deadline released an unknown operation")
	}
}

func TestWorkspaceMutationAuthorizationRechecksOwnerAccountAndFence(t *testing.T) {
	now := time.Now()
	user := &identity.User{ID: 1, Status: "active", Role: "admin"}
	w := &CloudComputerRow{ID: 2, OwnerUserID: 1, State: "ready", FenceVersion: 9}
	intent := workspaceFileIntent{WorkspaceFence: 9}
	if err := authorizeWorkspaceMutation(user, w, intent, now.Add(time.Minute), now); err != nil {
		t.Fatal(err)
	}
	user.ID = 3
	if authorizeWorkspaceMutation(user, w, intent, now.Add(time.Minute), now) == nil {
		t.Fatal("admin accessed someone else's personal files")
	}
	user.ID, user.Status = 1, "disabled"
	if authorizeWorkspaceMutation(user, w, intent, now.Add(time.Minute), now) == nil {
		t.Fatal("disabled actor dispatched")
	}
	user.Status = "active"
	if authorizeWorkspaceMutation(user, w, intent, now.Add(-time.Second), now) == nil {
		t.Fatal("expired mutation dispatched")
	}
	w.FenceVersion++
	if authorizeWorkspaceMutation(user, w, intent, now.Add(time.Minute), now) == nil {
		t.Fatal("retired workspace generation dispatched")
	}
}

type workspaceRecoveryProvider struct {
	sandboxcore.Provider
	state, output string
	execs         int
}

func (p *workspaceRecoveryProvider) Inspect(context.Context, sandboxcore.ResourceRef) (sandboxcore.Observation, error) {
	return sandboxcore.Observation{State: p.state}, nil
}
func (p *workspaceRecoveryProvider) InspectExecution(_ context.Context, handle sandboxcore.ExecutionHandle) (sandboxcore.ExecResult, error) {
	code := int32(0)
	return sandboxcore.ExecResult{Handle: &handle, ExitCode: &code}, nil
}
func (p *workspaceRecoveryProvider) ReadExecutionOutput(context.Context, sandboxcore.ExecutionHandle, int64, int) (sandboxcore.ExecutionOutput, error) {
	return sandboxcore.ExecutionOutput{Text: p.output, Cursor: int64(len(p.output))}, nil
}
func (p *workspaceRecoveryProvider) Exec(context.Context, sandboxcore.ResourceRef, sandboxcore.ExecSpec, sandboxcore.ExecCallbacks) (sandboxcore.ExecResult, error) {
	p.execs++
	panic("reconciliation must never execute")
}

type workspaceRecoveryFactory struct{ provider sandboxcore.Provider }

func (f workspaceRecoveryFactory) Open(context.Context, sandboxcore.Connection) (sandboxcore.Provider, error) {
	return f.provider, nil
}

func TestWorkspaceRecoveryObservesOnceAndDoesNotResumeRemainingRemoval(t *testing.T) {
	s, m, access := workspaceWorkerFixture()
	access.Resource = sandboxcore.ResourceRef{BackendGeneration: 1, RemoteID: "sandbox"}
	handle := sandboxcore.ExecutionHandle{Resource: access.Resource, ID: "helper"}
	p := &workspaceRecoveryProvider{state: "ready", output: `{"version":1,"ok":true,"changed":true,"result":{"removed":true}}`}
	s.Factory = workspaceRecoveryFactory{p}
	m.op.Intent = json.RawMessage(`{"items":[{"path":"first"},{"path":"second"}]}`)
	c := &workspaceClaim{op: &m.op, access: access, recovery: true, observation: workspaceOperationObservation{Executions: []workspaceHelperExecution{{State: "outcome_unknown", Handle: &handle, Request: workspacefs.Request{Operation: "remove", Path: "first"}}}}}
	if err := s.recoverWorkspaceOperation(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if p.execs != 0 || m.public.Status != "failed" || m.refs[0].State != "released" || m.public.ErrorCode == nil || *m.public.ErrorCode != "WORKSPACE_OPERATION_INTERRUPTED" || string(m.public.Result) != `{"affected_paths":["first"]}` {
		t.Fatalf("replayed or lost partial result: %s %s", m.public.Status, m.public.Result)
	}
}

func TestWorkspaceUnqueryableTransferNeedsWholeInstanceTermination(t *testing.T) {
	s, m, access := workspaceWorkerFixture()
	p := &workspaceRecoveryProvider{state: "ready"}
	s.Factory = workspaceRecoveryFactory{p}
	c := &workspaceClaim{op: &m.op, access: access, recovery: true, observation: workspaceOperationObservation{TransferState: "started"}}
	if err := s.recoverWorkspaceOperation(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if m.public.Status != "outcome_unknown" || m.refs[0].State != "unknown" {
		t.Fatal("unqueryable raw transfer released")
	}
	p.state = "absent"
	if err := s.recoverWorkspaceOperation(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if m.public.Status != "failed" || m.refs[0].State != "released" || p.execs != 0 {
		t.Fatal("verified absent instance did not release old transfer")
	}
}

func TestWorkspaceStoppedHelperWithMissingOutputFailsWithoutClaimingNoChange(t *testing.T) {
	s, m, access := workspaceWorkerFixture()
	handle := sandboxcore.ExecutionHandle{Resource: access.Resource, ID: "helper"}
	p := &workspaceRecoveryProvider{state: "ready", output: "unavailable"}
	s.Factory = workspaceRecoveryFactory{p}
	m.op.Intent = json.RawMessage(`{"items":[{"path":"first"}]}`)
	c := &workspaceClaim{op: &m.op, access: access, recovery: true, observation: workspaceOperationObservation{Executions: []workspaceHelperExecution{{State: "outcome_unknown", Handle: &handle, Request: workspacefs.Request{Operation: "remove", Path: "first"}}}}}
	if err := s.recoverWorkspaceOperation(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if m.public.Status != "failed" || m.public.ErrorCode == nil || *m.public.ErrorCode != "WORKSPACE_RESULT_UNAVAILABLE" || m.refs[0].State != "released" {
		t.Fatal("missing output was presented as success or replayed")
	}
}

type workspaceDispatchProvider struct {
	workspaceRecoveryProvider
}

func (p *workspaceDispatchProvider) Exec(ctx context.Context, resource sandboxcore.ResourceRef, spec sandboxcore.ExecSpec, callbacks sandboxcore.ExecCallbacks) (sandboxcore.ExecResult, error) {
	p.execs++
	request, err := workspacefs.Decode(spec.Argv[1])
	if err != nil || request.Operation != "mkdir" || request.Path != "storage/new-directory" {
		return sandboxcore.ExecResult{}, integrity()
	}
	handle := sandboxcore.ExecutionHandle{Resource: resource, ID: "helper"}
	if err := callbacks.Started(ctx, handle); err != nil {
		return sandboxcore.ExecResult{}, err
	}
	return sandboxcore.ExecResult{Handle: &handle, Running: true}, nil
}

func TestWorkspaceQueuedMutationDispatchesOnceAndSettlesBothRecords(t *testing.T) {
	s, m, _ := workspaceWorkerFixture()
	now := time.Now().UTC()
	m.op.Status, m.op.ActorKind, m.op.ActorID, m.op.Kind = "queued", "user", "1", "workspace_mkdir"
	m.op.BackendGeneration, m.op.DeadlineAt = 1, now.Add(time.Minute)
	m.op.Intent = json.RawMessage(`{"path":"storage/new-directory","workspace_fence":"9"}`)
	m.public.Status = "queued"
	m.refs = nil
	m.actor = identity.User{ID: 1, Status: "active", Role: "user"}
	m.w = CloudComputerRow{ID: 4, BackendGeneration: 1, OwnerUserID: 1, State: "ready", FenceVersion: 9}
	remote := "sandbox"
	m.w.RuntimeID = &remote
	m.w.RuntimeCreationToken = new("fixture-token")
	m.w.RuntimeGeneration = 1
	m.op.RuntimeGeneration = 1
	m.op.BackendGeneration = 1
	format, key := uint64(2), "v1"
	m.provider = SandboxConnectionRow{ID: 1, Endpoint: new("http://localhost:8080"), AccessMode: "direct", BackendGeneration: 1, MaintenanceState: "normal", SecretCiphertext: []byte("fixture"), SecretFormatVersion: &format, SecretKeyVersion: &key}
	s.Cipher = func(string, string, bool) (string, error) { return "fixture", nil }
	p := &workspaceDispatchProvider{workspaceRecoveryProvider: workspaceRecoveryProvider{state: "ready", output: `{"version":1,"ok":true,"changed":true,"result":{"path":"storage/new-directory"}}`}}
	s.Factory = workspaceRecoveryFactory{p}
	if err := s.processWorkspaceOperation(context.Background(), 2); err != nil {
		t.Fatal(err)
	}
	if p.execs != 1 || m.op.Status != "completed" || m.public.Status != "succeeded" || len(m.refs) != 1 || m.refs[0].State != "released" {
		t.Fatalf("dispatch incomplete: %d, %s, %s, error %v, %+v", p.execs, m.op.Status, m.public.Status, m.public.ErrorCode, m.refs)
	}
	if err := s.processWorkspaceOperation(context.Background(), 2); err != nil || p.execs != 1 {
		t.Fatal("completed mutation replayed")
	}
}

func TestWorkspaceDownloadCleanupProtectsLiveReadersAndFileTransfers(t *testing.T) {
	s, m, _ := workspaceWorkerFixture()
	var err error
	s.Host.Files, err = NewByteStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := NewStorageKey()
	if _, err := s.Host.Files.Write(context.Background(), key, strings.NewReader("private snapshot"), 100); err != nil {
		t.Fatal(err)
	}
	m.op.Kind, m.op.Status = "workspace_download", "completed"
	now := time.Now()
	m.op.FinishedAt = &now
	observation := workspaceOperationObservation{LocalStorageKey: key}
	m.op.Observation, _ = json.Marshal(observation)
	if err := s.cleanupOldWorkspaceDownload(context.Background(), &m.op); err != nil {
		t.Fatal(err)
	}
	reader, err := s.Host.Files.Open(key)
	if err != nil {
		t.Fatal("current HTTP reader's snapshot deleted")
	}
	_ = reader.Close()
	observation.LocalCleanupPending = true
	m.op.Observation, _ = json.Marshal(observation)
	m.op.Kind = "workspace_tool"
	if err := s.cleanupOldWorkspaceDownload(context.Background(), &m.op); err != nil {
		t.Fatal(err)
	}
	reader, err = s.Host.Files.Open(key)
	if err != nil {
		t.Fatal("present/import bytes deleted by unrelated worker")
	}
	_ = reader.Close()
	m.op.Kind = "workspace_download"
	if err := s.cleanupOldWorkspaceDownload(context.Background(), &m.op); err != nil {
		t.Fatal(err)
	}
	if reader, err = s.Host.Files.Open(key); err == nil {
		_ = reader.Close()
		t.Fatal("abandoned snapshot retained")
	}
	observation = workspaceOperationObservation{}
	if json.Unmarshal(m.op.Observation, &observation) != nil || observation.LocalStorageKey != "" || observation.LocalCleanupPending {
		t.Fatal("cleanup flag not cleared")
	}
}
