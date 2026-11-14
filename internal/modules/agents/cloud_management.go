package agents

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func cloudMaintenanceKind(kind string) bool {
	return kind == "create" || kind == "rebuild" || kind == "pause" || kind == "resume" || kind == "delete"
}
func sandboxOperationKind(kind string) bool {
	return strings.HasPrefix(kind, "cloud_") || kind == "workspace_mkdir" || kind == "workspace_remove"
}
func sandboxOperationAccess(tx identity.Tx, op *PublicOperationRow, a *identity.Auth) error {
	if op.Kind == "workspace_mkdir" || op.Kind == "workspace_remove" {
		if op.SubjectID == nil {
			return integrity()
		}
		cr, e := CloudStateFor(tx)
		if e != nil {
			return e
		}
		v, e := cr.Computer(*op.SubjectID, false)
		if e != nil {
			return e
		}
		return workspaceContentAccess(v, a)
	}
	if a.User.Role != "admin" {
		return missing()
	}
	return nil
}
func sandboxOperationView(_ identity.Tx, op *PublicOperationRow) (any, error) {
	return operationView(op), nil
}
func (s *Service) GetAdminOperation(ctx context.Context, raw string, id uint64) (*Result, error) {
	delegate := false
	out, e := s.access(ctx, raw, true, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		op, e := st.PublicOperation(id, false)
		if e != nil {
			return e
		}
		if op == nil {
			return missing()
		}
		if sandboxOperationKind(op.Kind) {
			if e = sandboxOperationAccess(tx, op, a); e != nil {
				return e
			}
			out.Data = operationView(op)
			return nil
		}
		if op.ContentDomain == "management" && op.Kind == "skill_validate" {
			delegate = true
			return nil
		}
		return missing()
	})
	if e == nil && delegate {
		if s.ManagementOperation == nil {
			return nil, unavailable()
		}
		return s.ManagementOperation(ctx, raw, id)
	}
	return out, e
}
func (s *CloudService) GetOperation(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.Host.GetOperation(ctx, raw, id)
}
func (s *CloudService) enqueueFileOperation(st StateRepository, cr CloudRepository, a *identity.Auth, receipt *Receipt, kind string, computer *CloudComputerRow, intent any) (*PublicOperationRow, error) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	config, e := json.Marshal(intent)
	if e != nil {
		return nil, e
	}
	public := &PublicOperationRow{CommandReceiptID: receipt.ID, Kind: kind, SubjectKind: "cloud_computer", SubjectID: &computer.ID, ContentDomain: "management", Status: "queued", ConfigSnapshot: config, Result: json.RawMessage(`null`), ActorUserID: a.User.ID, FenceVersion: 1, CreatedAt: now, DeadlineAt: now.Add(time.Minute), UpdatedAt: now}
	if e = st.InsertPublicOperation(public); e != nil {
		return nil, e
	}
	physical := &CloudOperationRow{ComputerID: computer.ID, Kind: kind, Status: "queued", OperationToken: cryptox.ID(), CommandReceiptID: &receipt.ID, PublicOperationID: &public.ID, BackendGeneration: computer.BackendGeneration, RuntimeGeneration: computer.RuntimeGeneration, StorageGeneration: computer.StorageGeneration, Intent: config, Observation: json.RawMessage(`{}`), ActorKind: "user", ActorID: idString(a.User.ID), ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, DeadlineAt: public.DeadlineAt, UpdatedAt: now}
	if e = cr.InsertCloudOperation(physical); e != nil {
		return nil, e
	}
	return public, nil
}
func (s *CloudService) cloudView(cr CloudRepository, v *CloudComputerRow) (CloudView, error) {
	activity, e := cr.CloudActivity(v.ID)
	if e != nil {
		return CloudView{}, e
	}
	latest, e := cr.LatestCloudOperation(v.ID)
	if e != nil {
		return CloudView{}, e
	}
	out := CloudView{ID: v.ID, OwnerUserID: v.OwnerUserID, PoolAgentID: v.PoolAgentID, State: v.State, BackendGeneration: v.BackendGeneration, RuntimeGeneration: v.RuntimeGeneration, StorageGeneration: v.StorageGeneration, Environment: v.EffectiveEnvironment, AppliedTemplateVersion: v.AppliedTemplateVersion, VolumeState: v.VolumeState, RuntimeID: v.RuntimeID, VolumeID: v.VolumeID, VolumeName: v.VolumeName, VolumeCleanupState: v.VolumeCleanupState, ActiveLeases: activity.Leases, PendingTransfers: activity.Transfers, UnknownExecutions: activity.Unknown, IdleSince: v.IdleSince, LastActivityAt: v.LastActivityAt, ErrorCode: v.ErrorCode, Version: strings.Trim(s.tag("computer", v.ID, v.RowVersion), `"`)}
	if latest != nil {
		out.LatestOperationID = latest.PublicOperationID
	}
	out.Capabilities = computerCapabilities(v)
	return out, nil
}
func (s *CloudService) ListComputers(ctx context.Context, raw string, q CloudQuery) (*Result, error) {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.PageSize < 1 || q.PageSize > 100 {
		return nil, httpx.Invalid("page_size", "out_of_range")
	}
	if q.State != "" && !strings.Contains("|uninitialized|provisioning|ready|paused|unavailable|deleting|deleted|", "|"+q.State+"|") {
		return nil, httpx.Invalid("state", "unsupported")
	}
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		rows, total, e := cr.Computers(q)
		if e != nil {
			return e
		}
		items := []CloudView{}
		for i := range rows {
			v, e := s.cloudView(cr, &rows[i])
			if e != nil {
				return e
			}
			items = append(items, v)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *CloudService) GetComputer(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		v, e := cr.Computer(id, false)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		out.Tag = s.tag("computer", id, v.RowVersion)
		out.Data, e = s.cloudView(cr, v)
		return e
	})
}
func (s *CloudService) GetPersonal(ctx context.Context, raw string) (*Result, error) {
	return s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, out *Result) error {
		v, e := cr.PersonalComputer(a.User.ID, false)
		if e != nil {
			return e
		}
		if v == nil {
			out.Data = nil
			return nil
		}
		out.Tag = s.tag("computer", v.ID, v.RowVersion)
		out.Data, e = s.cloudView(cr, v)
		return e
	})
}

// Content metadata follows the same owner boundary as file access. Global
// administrators cannot use this endpoint to inspect a human's private files.
func (s *CloudService) GetContentComputer(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, out *Result) error {
		v, err := cr.Computer(id, false)
		if err != nil {
			return err
		}
		if err = workspaceContentAccess(v, a); err != nil {
			return err
		}
		out.Tag = s.tag("computer", id, v.RowVersion)
		out.Data, err = s.cloudView(cr, v)
		return err
	})
}
func (s *CloudService) ActivatePersonal(ctx context.Context, raw string) (*Result, error) {
	return s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, out *Result) error {
		c, e := cr.Connection(true)
		if e != nil {
			return e
		}
		if c == nil {
			return integrity()
		}
		v, e := cr.PersonalComputer(a.User.ID, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if v == nil {
			v, e = newComputer(cr, c, a.User.ID, nil, now)
			if e != nil {
				return e
			}
		}
		if v.State == "uninitialized" || v.State == "paused" {
			kind := "create"
			if v.State == "paused" {
				kind = "resume"
			}
			if _, e = s.queueCloudOperation(cr, c, v, kind, "user", idString(a.User.ID), nil, nil, now); e != nil {
				return e
			}
		}
		out.Tag = s.tag("computer", v.ID, v.RowVersion)
		out.Data, e = s.cloudView(cr, v)
		return e
	})
}
func maintenanceBusy(cr CloudRepository, computerID uint64) error {
	a, e := cr.CloudActivity(computerID)
	if e != nil {
		return e
	}
	if a.Leases > 0 || a.Transfers > 0 || a.Unknown > 0 || a.References > 0 || a.Operations > 0 {
		return httpx.E(409, "CLOUD_COMPUTER_BUSY", "云电脑仍有在途或待核实的活动")
	}
	return nil
}

type CloudMaintenanceWrite struct {
	Action        string `json:"action"`
	ConfirmDelete bool   `json:"confirm_delete"`
}

func (s *CloudService) MaintainComputer(ctx context.Context, raw string, id uint64, tag, key string, w CloudMaintenanceWrite) (*Result, error) {
	if !cloudMaintenanceKind(w.Action) {
		return nil, httpx.Invalid("action", "unsupported")
	}
	if w.Action == "delete" && !w.ConfirmDelete {
		return nil, httpx.Invalid("confirm_delete", "required")
	}
	return s.cloudCommand(ctx, raw, key, "cloud_computer."+w.Action, "cloud_computer:"+idString(id), w, func(_ identity.Tx, _ Repository, st StateRepository, cr CloudRepository, a *identity.Auth, out *Result, receipt *Receipt) error {
		c, e := cr.Connection(true)
		if e != nil {
			return e
		}
		v, e := cr.Computer(id, true)
		if e != nil {
			return e
		}
		if c == nil || v == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag("computer", id, v.RowVersion)); e != nil {
			return e
		}
		if v.DeletedAt != nil {
			return httpx.E(409, "CLOUD_COMPUTER_DELETED", "云电脑已永久删除")
		}
		if e = maintenanceBusy(cr, id); e != nil {
			return e
		}
		if w.Action == "delete" && v.VolumeID != nil && computerCapabilities(v).VolumeDeletion == "unsupported" {
			return httpx.E(409, "CLOUD_VOLUME_DELETION_UNSUPPORTED", "后端不支持独立删除数据卷，无法完成永久删除")
		}
		if w.Action == "pause" && v.State != "ready" || w.Action == "resume" && v.State != "paused" || w.Action == "create" && v.State != "uninitialized" && v.State != "unavailable" {
			return httpx.E(409, "CLOUD_STATE_CONFLICT", "云电脑当前状态不支持此操作")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if w.Action == "delete" {
			sessions, e := cr.ComputerSessions(id)
			if e != nil {
				return e
			}
			for i := range sessions {
				commit, e := cancelSessionQueue(st, &sessions[i], "CLOUD_COMPUTER_DELETED", now)
				if e != nil {
					return e
				}
				out.Commits = append(out.Commits, commit)
			}
		}
		config, _ := json.Marshal(w)
		public := &PublicOperationRow{CommandReceiptID: receipt.ID, Kind: "cloud_" + w.Action, SubjectKind: "cloud_computer", SubjectID: &id, ContentDomain: "management", Status: "queued", ConfigSnapshot: config, Result: json.RawMessage(`null`), ActorUserID: a.User.ID, FenceVersion: 1, CreatedAt: now, DeadlineAt: now.Add(5 * time.Minute), UpdatedAt: now}
		if e = st.InsertPublicOperation(public); e != nil {
			return e
		}
		if _, e = s.queueCloudOperation(cr, c, v, w.Action, "user", idString(a.User.ID), &receipt.ID, &public.ID, now); e != nil {
			return e
		}
		out.Status = 202
		out.Location = "/api/v1/admin/agents/operations/" + idString(public.ID)
		out.Data = operationView(public)
		return nil
	})
}
