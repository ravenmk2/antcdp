package agents

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const sessionWorkspaceUploadCommand = "workspace.session_upload"

type workspacePreparation struct {
	Status    string  `json:"status"`
	ID        *uint64 `json:"operation_id,string,omitempty"`
	ErrorCode *string `json:"error_code,omitempty"`
}

func (s *CloudService) lockWorkspaceSession(tx identity.Tx, r Repository, st StateRepository, auth *identity.Auth, id uint64, prepare bool) (*SessionRow, *Definition, *SandboxConnection, error) {
	initial, err := s.Host.sessionAccess(st, id, auth, true, false)
	if err != nil {
		return nil, nil, nil, err
	}
	if initial.ExecutionMode != "chat" {
		return nil, nil, nil, serviceAutomationOnly()
	}
	if _, err = executionAccount(tx, initial, true); err != nil {
		return nil, nil, nil, err
	}
	agent, err := r.Definition(initial.AgentID, prepare)
	if err != nil {
		return nil, nil, nil, err
	}
	if err = s.Host.definition(agent); err != nil {
		return nil, nil, nil, err
	}
	if !agent.Enabled {
		return nil, nil, nil, httpx.E(409, "AGENT_UNAVAILABLE", "助手当前不可用")
	}
	if err = requireSessionAgent(r, agent, auth.User); err != nil {
		return nil, nil, nil, err
	}
	connection, err := s.Connection()
	if err != nil {
		return nil, nil, nil, err
	}
	session, err := lockSessionContent(st, id, auth)
	if err != nil {
		return nil, nil, nil, err
	}
	if session.ArchivedAt != nil {
		return nil, nil, nil, httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
	}
	if connection == nil || connection.Endpoint == nil {
		return nil, nil, nil, httpx.E(409, "SANDBOX_NOT_CONFIGURED", "请管理员配置沙箱服务连接")
	}
	if connection.MaintenanceState != "normal" {
		return nil, nil, nil, httpx.E(409, "CLOUD_MAINTENANCE", "沙箱连接正在维护")
	}
	return session, agent, connection, nil
}

func (s *CloudService) PrepareSessionWorkspace(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.cloudAccess(ctx, raw, false, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository, auth *identity.Auth, out *Result) error {
		session, agent, connection, err := s.lockWorkspaceSession(tx, r, st, auth, id, true)
		if err != nil {
			return err
		}
		before := session.LastSeq
		now := time.Now().UTC().Truncate(time.Millisecond)
		computer, err := s.allocateSession(repo, st, connection, agent, session, now)
		if err != nil {
			return err
		}
		if computer == nil {
			return httpx.E(409, "CLOUD_COMPUTER_BUSY", "机器人的云电脑池当前已满")
		}
		if computer.BackendGeneration != connection.BackendGeneration {
			return workspacePreparationRequired()
		}
		if session.LastSeq > before {
			out.Commits = append(out.Commits, eventReceipt(id, before+1, session.LastSeq))
		}
		return s.prepareWorkspaceComputer(repo, connection, computer, auth.User.ID, now, out)
	})
}

func (s *CloudService) prepareWorkspaceComputer(repo CloudRepository, connection *SandboxConnection, computer *CloudComputerRow, actor uint64, now time.Time, out *Result) error {
	op, err := repo.ActiveCloudOperation(computer.ID)
	if err != nil {
		return err
	}
	if op == nil && computer.State == "ready" {
		out.Data = workspacePreparation{Status: "ready"}
		return nil
	}
	if op == nil && (computer.State == "uninitialized" || computer.State == "paused") {
		if err = maintenanceBusy(repo, computer.ID); err != nil {
			return err
		}
		kind := "create"
		if computer.State == "paused" {
			kind = "resume"
		}
		op, err = s.queueCloudOperation(repo, connection, computer, kind, "user", idString(actor), nil, nil, now)
		if err != nil {
			return err
		}
	}
	if op == nil {
		return httpx.E(409, "CLOUD_NOT_READY", "云电脑暂不可用")
	}
	if !workspacePreparationOperation(op) {
		return httpx.E(409, "CLOUD_COMPUTER_BUSY", "云电脑正在维护，请稍后重试")
	}
	out.Status, out.Data = http.StatusAccepted, workspacePreparation{Status: "preparing", ID: &op.ID}
	return nil
}

func workspacePreparationOperation(op *CloudOperationRow) bool {
	return op != nil && (op.Kind == "create" || op.Kind == "resume")
}

func (s *CloudService) GetSessionWorkspaceOperation(ctx context.Context, raw string, sessionID, operationID uint64) (*Result, error) {
	return s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository, auth *identity.Auth, out *Result) error {
		session, err := s.Host.sessionAccess(st, sessionID, auth, true, false)
		if err != nil {
			return err
		}
		op, err := repo.CloudOperation(operationID, false)
		if err != nil {
			return err
		}
		if session.CloudComputerID == nil || !workspacePreparationOperation(op) || op.ComputerID != *session.CloudComputerID {
			return missing()
		}
		out.Data = workspacePreparation{Status: cloudPublicOperation(op).Status, ID: &op.ID, ErrorCode: op.ErrorCode}
		return nil
	})
}

func workspacePreparationRequired() error {
	return httpx.E(409, "WORKSPACE_PREPARATION_REQUIRED", "请先准备当前会话的云电脑")
}

func (s *CloudService) UploadSessionWorkspaceFile(ctx context.Context, raw string, id uint64, key, filename string, source io.Reader) (*Result, error) {
	if !validWorkspaceUploadName(filename) {
		return nil, httpx.Invalid("file", "invalid_filename")
	}
	var claim *workspaceClaim
	out, err := s.cloudAccess(ctx, raw, false, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository, auth *identity.Auth, out *Result) error {
		session, _, connection, e := s.lockWorkspaceSession(tx, r, st, auth, id, false)
		if e != nil {
			return e
		}
		scope := "session:" + idString(id)
		return s.cloudReceipt(ctx, tx, repo, auth, out, key, sessionWorkspaceUploadCommand, scope, filename, func(receipt *Receipt) error {
			claim, e = s.reserveSessionUpload(st, repo, session, connection, auth, receipt, filename)
			if e == nil {
				out.Status, out.Data = http.StatusAccepted, operationView(cloudPublicOperation(claim.op))
			}
			return e
		})
	})
	if err != nil || claim == nil {
		return out, err
	}
	_, cause := s.executeWorkspaceUpload(ctx, claim, source, true)
	if cause != nil {
		return out, cause
	}
	// The native upload is settled before its result is exposed. The receipt
	// also reads this operation if the response is lost after publication.
	return out, s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		op, err := repo.CloudOperation(claim.op.ID, false)
		if err != nil {
			return err
		}
		if op == nil {
			return integrity()
		}
		out.Status, out.Data = workspaceResponseStatus(op), operationView(cloudPublicOperation(op))
		return nil
	})
}

func (s *CloudService) reserveSessionUpload(st StateRepository, repo CloudRepository, session *SessionRow, connection *SandboxConnection, auth *identity.Auth, receipt *Receipt, filename string) (*workspaceClaim, error) {
	if session.CloudComputerID == nil {
		return nil, workspacePreparationRequired()
	}
	computer, err := repo.Computer(*session.CloudComputerID, true)
	if err != nil {
		return nil, err
	}
	if err = contentAccess(session, auth); err != nil {
		return nil, err
	}
	if !sessionMatchesComputer(session, computer) {
		return nil, integrity()
	}
	if computer.DeletedAt == nil && (computer.State == "uninitialized" || computer.State == "paused" || computer.State == "provisioning") {
		return nil, workspacePreparationRequired()
	}
	access, resolvedConnection, err := s.accessFromRows(connection, computer)
	if err != nil {
		return nil, err
	}
	blocked, err := repo.SessionUploadBlocked(computer.ID, session.ID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, httpx.E(409, "CLOUD_COMPUTER_BUSY", "云电脑有冲突或待核实的操作，请稍后重试")
	}
	cwd, err := sessionCWD(session)
	if err != nil {
		return nil, err
	}
	intent := workspaceFileIntent{Path: path.Join(strings.TrimPrefix(cwd, "/data/"), filename), WorkspaceFence: computer.FenceVersion}
	op, err := s.startWorkspaceOperation(st, repo, access, "workspace_upload", "user", idString(auth.User.ID), intent)
	if err != nil {
		return nil, err
	}
	op.CommandReceiptID, receipt.OperationID = &receipt.ID, &op.ID
	receipt.TargetID = &session.ID
	kind := "session"
	receipt.TargetKind = &kind
	if err = repo.SaveCloudOperation(op); err != nil {
		return nil, err
	}
	return &workspaceClaim{op: op, access: access, connection: resolvedConnection, intent: intent}, nil
}

// Resolve paths from the submitting user's session-scoped upload receipts. Capture
// the result in the accepted input so claim and replay need no live workspace.
func resolveWorkspaceUploads(tx identity.Tx, session *SessionRow, actor uint64, keys []string) ([]agentcore.WorkspaceFile, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	repo, err := CloudStateFor(tx)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(keys))
	files := make([]agentcore.WorkspaceFile, 0, len(keys))
	pathBytes := 0
	for _, key := range keys {
		if !keyPattern.MatchString(key) || seen[key] {
			return nil, httpx.Invalid("workspace_upload_keys", "invalid_or_duplicate")
		}
		seen[key] = true
		receipt, err := repo.CloudReceipt(idString(actor), "session", idString(session.ID), sessionWorkspaceUploadCommand, key)
		if err != nil {
			return nil, err
		}
		if receipt == nil || receipt.Status != "completed" || receipt.OperationID == nil {
			return nil, httpx.Invalid("workspace_upload_keys", "upload_unavailable")
		}
		op, err := workspaceReceiptOperation(repo, receipt)
		if err != nil {
			return nil, err
		}
		public := cloudPublicOperation(op)
		if op.Kind != "workspace_upload" || public.Status != "succeeded" || session.CloudComputerID == nil || op.ComputerID != *session.CloudComputerID {
			return nil, httpx.Invalid("workspace_upload_keys", "upload_unavailable")
		}
		var result struct {
			Path string `json:"path"`
		}
		if json.Unmarshal(public.Result, &result) != nil || result.Path == "" {
			return nil, integrity()
		}
		name := "/data/" + result.Path
		pathBytes += len(name)
		if pathBytes > 32<<10 {
			return nil, httpx.Invalid("workspace_upload_keys", "paths_too_large")
		}
		files = append(files, agentcore.WorkspaceFile{OperationID: agentcore.ID(op.ID), Filename: path.Base(name), Path: name})
	}
	return files, nil
}

func sessionMatchesComputer(s *SessionRow, c *CloudComputerRow) bool {
	return c != nil && c.OwnerUserID == s.RunAsUserID && (s.ExecutorKind == "robot" && c.AllocationKind == "robot_pool" && sameWorkspaceUser(s.ChatUserID, c.WorkspaceUserID) || s.ExecutorKind == "chat_user" && c.AllocationKind == "personal")
}

func sameWorkspaceUser(a, b *uint64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
