package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type workspaceClaim struct {
	op          *CloudOperationRow
	access      *SandboxAccess
	connection  CloudConnection
	observation workspaceOperationObservation
	intent      workspaceFileIntent
	recovery    bool
	terminated  bool
	cause       error
}

// ProcessWorkspaceOperations dispatches queued user mutations once. All other
// unfinished operations are observed only; no interrupted helper is replayed.
func (s *CloudService) ProcessWorkspaceOperations(ctx context.Context, limit int) error {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	var rows []CloudOperationRow
	err := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		var err error
		rows, err = repo.PendingWorkspaceOperations(s.Epoch, time.Now().UTC(), limit)
		return err
	})
	if err != nil {
		return err
	}
	var failures []error
	for i := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		row := &rows[i]
		if row.FinishedAt != nil {
			if err := s.cleanupOldWorkspaceDownload(ctx, row); err != nil {
				failures = append(failures, err)
			}
			continue
		}
		if err := s.processWorkspaceOperation(ctx, row.ID); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *CloudService) cleanupOldWorkspaceDownload(ctx context.Context, row *CloudOperationRow) error {
	if row.Kind != "workspace_download" || s.Host.Files == nil {
		return nil
	}
	var observation workspaceOperationObservation
	if json.Unmarshal(row.Observation, &observation) != nil {
		return integrity()
	}
	if row.ExecutorEpoch == s.Epoch && !observation.LocalCleanupPending {
		return nil
	}
	if observation.LocalStorageKey == "" {
		return nil
	}
	return s.deleteWorkspaceDownload(ctx, row.ID, observation.LocalStorageKey)
}

func (s *CloudService) claimWorkspaceOperation(ctx context.Context, id uint64) (*workspaceClaim, error) {
	var claimed *workspaceClaim
	err := s.cloudBackground(ctx, func(tx identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		initial, err := repo.CloudOperation(id, false)
		if err != nil || initial == nil || initial.FinishedAt != nil {
			return err
		}
		if initial.ComputerID == 0 {
			return integrity()
		}
		var actor *identity.User
		if initial.Status == "queued" {
			actorID, err := strconv.ParseUint(initial.ActorID, 10, 64)
			if err != nil || initial.ActorKind != "user" || actorID == 0 {
				return integrity()
			}
			users, err := tx.LockUsers([]uint64{actorID})
			if err != nil {
				return err
			}
			actor = users[actorID]
		}
		w, err := repo.Computer(initial.ComputerID, true)
		if err != nil {
			return err
		}
		instance, err := repo.Computer(initial.ComputerID, true)
		if err != nil {
			return err
		}
		op, err := repo.CloudOperation(id, true)
		if err != nil || op == nil || op.FinishedAt != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if op.FenceVersion != initial.FenceVersion || op.Status == "running" && op.ExecutorEpoch == s.Epoch && op.DeadlineAt.After(now) {
			return nil
		}
		if w == nil || instance == nil || instance.ID != w.ID || instance.BackendGeneration != op.BackendGeneration || instance.RuntimeGeneration != op.RuntimeGeneration || instance.StorageGeneration != op.StorageGeneration {
			return integrity()
		}
		c := &workspaceClaim{op: op, recovery: op.Status != "queued", terminated: instance.DeletedAt != nil}
		if len(op.Observation) > 0 && string(op.Observation) != "null" && json.Unmarshal(op.Observation, &c.observation) != nil {
			return integrity()
		}
		if !c.recovery {
			if op.Kind != "workspace_mkdir" && op.Kind != "workspace_remove" || json.Unmarshal(op.Intent, &c.intent) != nil {
				return integrity()
			}
			c.cause = authorizeWorkspaceMutation(actor, w, c.intent, op.DeadlineAt, now)
			if c.cause == nil {
				activity, err := repo.CloudActivity(w.ID)
				if err != nil {
					return err
				}
				if activity.Leases > 0 || activity.Transfers > 0 || activity.Unknown > 0 || activity.References > 0 || activity.Operations > 1 {
					c.cause = httpx.E(409, "WORKSPACE_BUSY", "工作空间已被其他运行或维护占用")
				}
			}
		}
		c.access = &SandboxAccess{ComputerID: w.ID, BackendGeneration: instance.BackendGeneration, RuntimeGeneration: instance.RuntimeGeneration, StorageGeneration: instance.StorageGeneration, CWD: "/data", OperationID: op.ID}
		if op.RootRunID != nil {
			c.access.BindingID = *op.RootRunID
		}
		if c.terminated && !c.recovery && c.cause == nil {
			c.cause = httpx.E(409, "SANDBOX_NOT_READY", "实例已停止，未派发操作")
		}
		if !c.terminated {
			c.access.Resource, err = s.resource(instance)
			if err != nil {
				c.cause = err
			}
			p, err := repo.Connection(false)
			if err != nil || p == nil {
				return errors.Join(err, integrity())
			}
			if !c.recovery && (p.MaintenanceState != "normal" || instance.State != "ready") {
				c.cause = httpx.E(409, "SANDBOX_NOT_READY", "沙箱当前不可执行文件维护")
			}
			c.connection, err = s.runtimeConnection(p)
			if err != nil {
				c.cause = err
			}
		}
		op.ExecutorEpoch = s.Epoch
		op.FenceVersion++
		op.Status = "running"
		if c.recovery {
			op.Status = "outcome_unknown"
		}
		op.UpdatedAt = now
		if op.StartedAt == nil {
			op.StartedAt = &now
		}
		c.access.HelperOperationID, c.access.HelperOperationFence = op.ID, op.FenceVersion
		if err = repo.SaveCloudOperation(op); err != nil {
			return err
		}
		if !c.recovery && c.cause == nil {
			if err = s.acquireReferences(st, repo, c.access, "cloud_file_operation", workspaceHolder(op.ID)); err != nil {
				return err
			}
		}
		if op.PublicOperationID != nil {
			public, err := st.PublicOperation(*op.PublicOperationID, true)
			if err != nil || public == nil {
				return errors.Join(err, integrity())
			}
			public.Status, public.StartedAt, public.UpdatedAt = op.Status, op.StartedAt, now
			public.ExecutorEpoch, public.FenceVersion = &op.ExecutorEpoch, op.FenceVersion
			if err = st.SavePublicOperation(public); err != nil {
				return err
			}
		}
		claimed = c
		return nil
	})
	return claimed, err
}

func authorizeWorkspaceMutation(actor *identity.User, w *CloudComputerRow, intent workspaceFileIntent, deadline, now time.Time) error {
	if actor == nil || actor.DeletedAt != nil || actor.Status != "active" {
		return httpx.E(403, "FORBIDDEN", "发起者账号已不可用")
	}
	if err := workspaceContentAccess(w, &identity.Auth{User: actor}); err != nil {
		return err
	}
	if !deadline.After(now) {
		return httpx.E(409, "WORKSPACE_OPERATION_EXPIRED", "文件维护等待期限已到，未派发操作")
	}
	if w.DeletedAt != nil || w.State != "ready" || w.FenceVersion != intent.WorkspaceFence {
		return httpx.E(409, "WORKSPACE_UNAVAILABLE", "工作空间已变化，未派发操作")
	}
	return nil
}

func (s *CloudService) processWorkspaceOperation(ctx context.Context, id uint64) error {
	c, err := s.claimWorkspaceOperation(ctx, id)
	if err != nil || c == nil {
		return err
	}
	if c.recovery {
		return s.recoverWorkspaceOperation(ctx, c)
	}
	affected := []string{}
	if c.terminated && c.cause == nil {
		c.cause = httpx.E(409, "SANDBOX_NOT_READY", "实例已停止，未派发操作")
	}
	if c.cause != nil {
		return s.finishWorkspaceOperation(ctx, id, c.access, map[string]any{"affected_paths": affected}, c.cause)
	}
	bounded, cancel := context.WithDeadline(ctx, c.op.DeadlineAt)
	defer cancel()
	c.access.Provider, err = s.openProvider(bounded, c.connection)
	if err == nil {
		requests := mutationRequests(c.op.Kind, c.intent)
		for _, request := range requests {
			if bounded.Err() != nil || !time.Now().Before(c.op.DeadlineAt) {
				err = httpx.E(409, "WORKSPACE_OPERATION_INTERRUPTED", "操作期限已到，剩余文件未继续处理")
				break
			}
			var response workspacefs.Response
			response, err = s.workspaceHelper(bounded, c.access, id, request)
			if response.Changed {
				affected = append(affected, request.Path)
			}
			if err != nil {
				break
			}
		}
	}
	return s.finishWorkspaceOperation(ctx, id, c.access, map[string]any{"affected_paths": affected}, err)
}

func mutationRequests(kind string, intent workspaceFileIntent) []workspacefs.Request {
	if kind == "workspace_mkdir" {
		return []workspacefs.Request{{Operation: "mkdir", Path: intent.Path}}
	}
	requests := make([]workspacefs.Request, 0, len(intent.Items))
	for _, item := range intent.Items {
		requests = append(requests, workspacefs.Request{Operation: "remove", Path: item.Path, Identity: item.Identity, Recursive: intent.Recursive})
	}
	return requests
}

func (s *CloudService) recoverWorkspaceOperation(ctx context.Context, c *workspaceClaim) error {
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if !c.terminated && c.cause == nil {
		c.access.Provider, c.cause = s.openProvider(bounded, c.connection)
	}
	if !c.terminated && c.cause == nil {
		actual, err := c.access.Provider.Inspect(bounded, c.access.Resource)
		if err == nil {
			c.terminated = actual.State == "absent" || actual.State == "terminated"
		}
	}
	confirmed := c.terminated || c.cause == nil
	if !c.terminated && c.observation.TransferState == "started" {
		confirmed = false
	}
	for i := range c.observation.Executions {
		execution := &c.observation.Executions[i]
		if execution.State == "completed" && execution.Response != nil {
			continue
		}
		if c.terminated {
			continue
		}
		if c.access.Provider == nil || execution.Handle == nil || execution.Handle.Resource != c.access.Resource {
			confirmed = false
			continue
		}
		result, output, err := awaitWorkspaceHelper(bounded, c.access.Provider, *execution.Handle)
		if result.Running || result.ExitCode == nil {
			confirmed = false
			continue
		}
		response, valid := recoveredHelperResponse(output)
		if err != nil || !valid {
			response = workspacefs.Response{Version: workspacefs.Version, Code: "WORKSPACE_RESULT_UNAVAILABLE"}
		}
		execution.State, execution.Response = "completed", &response
	}
	result, cause := recoveredWorkspaceResult(c.op, c.observation)
	if !confirmed {
		cause = httpx.E(409, "WORKSPACE_IO_OUTCOME_UNKNOWN", "文件维护的物理执行仍未核实")
	}
	if confirmed && c.op.Kind == "workspace_download" && c.observation.LocalStorageKey != "" {
		c.observation.LocalCleanupPending = true
	}
	if err := s.settleWorkspaceOperation(ctx, c.op.ID, c.access, &c.observation, result, cause, confirmed); err != nil {
		return err
	}
	if confirmed && c.op.Kind == "workspace_download" && c.observation.LocalStorageKey != "" && s.Host.Files != nil {
		return s.deleteWorkspaceDownload(ctx, c.op.ID, c.observation.LocalStorageKey)
	}
	return nil
}

func recoveredHelperResponse(raw []byte) (workspacefs.Response, bool) {
	var response workspacefs.Response
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	valid := len(raw) <= workspacefs.MaxResponseBytes && decoder.Decode(&response) == nil && decoder.Decode(new(any)) == io.EOF && response.Version == workspacefs.Version
	return response, valid
}

func recoveredWorkspaceResult(op *CloudOperationRow, observation workspaceOperationObservation) (map[string]any, error) {
	affected := []string{}
	var cause error
	for _, execution := range observation.Executions {
		if execution.State != "completed" || execution.Response == nil {
			cause = httpx.E(409, "WORKSPACE_RESULT_UNAVAILABLE", "操作已停止，但部分结果无法恢复，请重新检查文件")
			continue
		}
		if execution.Response.Changed && (execution.Request.Operation == "mkdir" || execution.Request.Operation == "remove") {
			affected = append(affected, execution.Request.Path)
		}
		if !execution.Response.OK {
			cause = helperFailure(execution.Response.Code)
		}
	}
	var intent workspaceFileIntent
	if op.Kind == "workspace_mkdir" || op.Kind == "workspace_remove" {
		if json.Unmarshal(op.Intent, &intent) != nil || len(observation.Executions) != len(mutationRequests(op.Kind, intent)) {
			cause = httpx.E(409, "WORKSPACE_OPERATION_INTERRUPTED", "操作已中断，剩余文件未继续处理")
		}
	} else {
		// Read/tool callers have gone away. Physical reconciliation never
		// fabricates a successful business result or restarts their parent Run.
		cause = httpx.E(409, "WORKSPACE_OPERATION_INTERRUPTED", "原请求已中断，物理执行已核实")
	}
	return map[string]any{"affected_paths": affected}, cause
}

// Public completion, physical completion and reference release share one
// transaction. A stale callback cannot release a newly fenced holder.
func (s *CloudService) settleWorkspaceOperation(ctx context.Context, id uint64, access *SandboxAccess, recovered *workspaceOperationObservation, result any, cause error, confirmed bool) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.cloudBackground(cleanup, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		if _, err := repo.Computer(access.ComputerID, true); err != nil {
			return err
		}
		row, err := repo.CloudOperation(id, true)
		if err != nil {
			return err
		}
		if row == nil || row.ExecutorEpoch != s.Epoch || row.FenceVersion != access.HelperOperationFence || access.HelperOperationID != id {
			return httpx.E(409, "OPERATION_FENCED", "原文件请求已被接管")
		}
		if row.FinishedAt != nil {
			return nil
		}
		var observation workspaceOperationObservation
		if len(row.Observation) > 0 && string(row.Observation) != "null" && json.Unmarshal(row.Observation, &observation) != nil {
			return integrity()
		}
		if recovered != nil {
			observation = *recovered
		} else if row.Status == "outcome_unknown" {
			confirmed = false
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		row.Status, row.ErrorCode, row.UpdatedAt = "completed", nil, now
		if cause != nil {
			code := remoteSandboxError(cause)
			var failure *httpx.Error
			if errors.As(cause, &failure) {
				code = failure.Code
			}
			row.Status, row.ErrorCode = "failed", &code
		}
		if confirmed {
			row.FinishedAt = &now
		} else {
			code := "WORKSPACE_IO_OUTCOME_UNKNOWN"
			row.Status, row.ErrorCode = "outcome_unknown", &code
		}
		observation.Result, err = json.Marshal(result)
		if err != nil {
			return err
		}
		row.Observation, err = json.Marshal(observation)
		if err != nil {
			return err
		}
		refs, err := repo.HolderReferences("cloud_file_operation", workspaceHolder(id), true)
		if err != nil {
			return err
		}
		for i := range refs {
			ref := &refs[i]
			if ref.State == "released" {
				continue
			}
			ref.State, ref.UpdatedAt = "unknown", now
			ref.FenceVersion++
			reason := "workspace_execution_unconfirmed"
			ref.ReleaseEvidence = json.RawMessage(`{"physical_completion_verified":false}`)
			if confirmed {
				ref.State, ref.ReleasedAt, ref.LastVerifiedAt = "released", &now, &now
				reason = "workspace_execution_verified"
				ref.ReleaseEvidence = json.RawMessage(`{"physical_completion_verified":true}`)
			}
			ref.ReleaseReason = &reason
			if err = st.SaveResourceReference(ref); err != nil {
				return err
			}
		}
		if err = repo.SaveCloudOperation(row); err != nil {
			return err
		}
		if row.PublicOperationID == nil {
			return nil
		}
		public, err := st.PublicOperation(*row.PublicOperationID, true)
		if err != nil || public == nil {
			return errors.Join(err, integrity())
		}
		public.Status, public.ErrorCode, public.FinishedAt, public.UpdatedAt = row.Status, row.ErrorCode, row.FinishedAt, now
		if public.Status == "completed" {
			public.Status = "succeeded"
		}
		public.Result = observation.Result
		return st.SavePublicOperation(public)
	})
}
