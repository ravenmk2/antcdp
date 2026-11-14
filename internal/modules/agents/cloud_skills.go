package agents

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

func (s *CloudService) lockSkillPreparation(ctx context.Context, key string) (func(), error) {
	for {
		s.skillMu.Lock()
		if s.skillPreparations == nil {
			s.skillPreparations = map[string]chan struct{}{}
		}
		prior := s.skillPreparations[key]
		if prior == nil {
			done := make(chan struct{})
			s.skillPreparations[key] = done
			s.skillMu.Unlock()
			return func() { s.skillMu.Lock(); delete(s.skillPreparations, key); close(done); s.skillMu.Unlock() }, nil
		}
		s.skillMu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-prior:
		}
	}
}

func (s *CloudService) prepareSkills(ctx context.Context, original *SandboxAccess, x agentcore.ExecutionContext) error {
	release, err := s.lockSkillPreparation(ctx, idString(original.ComputerID)+"/"+idString(uint64(x.AgentID)))
	if err != nil {
		return err
	}
	defer release()
	var manifest []SkillSnapshot
	var files []FileRow
	var hash string
	ready := false
	err = s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, cr CloudRepository) error {
		current, err := s.Host.lockExecution(tx, r, st, x.Ref, true)
		if err != nil {
			return err
		}
		manifest, err = frozenSkills(current.Context.Row)
		if err != nil {
			return err
		}
		hash, err = skillSetHash(manifest)
		if err != nil {
			return err
		}
		state, err := cr.SkillState(original.ComputerID, uint64(x.AgentID), false)
		if err != nil {
			return err
		}
		if state == nil && len(manifest) == 0 {
			ready = true
			return nil
		}
		if state != nil {
			if state.State == "ready" && state.BackendGeneration == original.BackendGeneration && state.StorageGeneration == original.StorageGeneration && state.InstalledSetHash == hash {
				ready = true
				return nil
			}
			if state.State == "preparing" {
				op, err := cr.CloudOperationByToken(state.SyncToken, false)
				if err != nil {
					return err
				}
				if op != nil && op.FinishedAt == nil {
					return httpx.E(409, "SKILL_SYNC_RECONCILING", "技能目录的上一次更新仍在核实")
				}
			}
		}
		for _, skill := range manifest {
			file, err := st.File(skill.FileID, false)
			if err != nil {
				return err
			}
			if file == nil || file.State != "bound" || file.ContentDomain != "system_skill" || file.SizeBytes == nil || file.IntegrityState != "verified" || hexHash(file.SHA256) != skill.ArchiveSHA {
				return integrity()
			}
			files = append(files, *file)
		}
		return nil
	})
	if err != nil || ready {
		return err
	}
	bundle, err := s.skillBundle(ctx, manifest, files)
	if err != nil {
		return err
	}
	checksum := sha256.Sum256(bundle)
	token := cryptox.ID()
	request := workspacefs.Request{Operation: "skills_install", AgentID: idString(uint64(x.AgentID)), Token: token, SkillSetHash: hash, ExpectedHash: hex.EncodeToString(checksum[:]), Skills: []workspacefs.SkillArchive{}}
	for _, skill := range manifest {
		request.Skills = append(request.Skills, workspacefs.SkillArchive{Name: skill.Name, ArchiveSHA: skill.ArchiveSHA, ContentSHA: skill.ContentSHA})
	}
	access := *original
	access.ReferenceIDs = nil
	access.HelperOperationID = 0
	access.HelperOperationFence = 0
	var op *CloudOperationRow
	err = s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, cr CloudRepository) error {
		if _, err := s.Host.lockExecution(tx, r, st, x.Ref, true); err != nil {
			return err
		}
		computer, err := cr.Computer(access.ComputerID, true)
		if err != nil {
			return err
		}
		if computer == nil || computer.BackendGeneration != access.BackendGeneration || computer.RuntimeGeneration != access.RuntimeGeneration || computer.StorageGeneration != access.StorageGeneration || computer.State != "ready" {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "技能更新目标已变化")
		}
		op, err = s.startWorkspaceOperation(st, cr, &access, "workspace_skill", "system", "system", request)
		if err != nil {
			return err
		}
		op.DeadlineAt = time.Now().UTC().Add(5 * time.Minute)
		if err = cr.SaveCloudOperation(op); err != nil {
			return err
		}
		old, err := cr.SkillState(access.ComputerID, uint64(x.AgentID), true)
		if err != nil {
			return err
		}
		if old == nil {
			old = &CloudSkillStateRow{ComputerID: access.ComputerID, AgentID: uint64(x.AgentID), InstalledManifest: json.RawMessage(`[]`)}
		}
		old.BackendGeneration, old.StorageGeneration, old.State, old.SyncToken = access.BackendGeneration, access.StorageGeneration, "preparing", op.OperationToken
		old.RowVersion++
		old.FenceVersion++
		old.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
		return cr.SaveSkillState(old)
	})
	if err != nil {
		return err
	}
	err = s.uploadSkillBundle(ctx, &access, token, bundle)
	var result workspacefs.Response
	if err == nil {
		result, err = s.workspaceHelper(ctx, &access, op.ID, request)
	}
	cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer done()
	if cleanErr := s.cleanupKnownFileTransfer(cleanup, &access); err == nil {
		err = cleanErr
	}
	if finish := s.finishWorkspaceOperation(cleanup, op.ID, &access, result, err); err == nil {
		err = finish
	}
	if err != nil {
		return err
	}
	var installed struct {
		Installed bool   `json:"installed"`
		Hash      string `json:"skill_set_hash"`
	}
	if json.Unmarshal(result.Result, &installed) != nil || !installed.Installed || installed.Hash != hash {
		return integrity()
	}
	return s.cloudBackground(cleanup, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		computer, err := cr.Computer(access.ComputerID, true)
		if err != nil {
			return err
		}
		state, err := cr.SkillState(access.ComputerID, uint64(x.AgentID), true)
		if err != nil {
			return err
		}
		if computer == nil || state == nil || state.SyncToken != op.OperationToken || computer.BackendGeneration != access.BackendGeneration || computer.StorageGeneration != access.StorageGeneration {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "技能更新目标已变化")
		}
		state.InstalledManifest, err = json.Marshal(manifest)
		if err != nil {
			return err
		}
		state.State, state.InstalledSetHash = "ready", hash
		state.RowVersion++
		state.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
		return cr.SaveSkillState(state)
	})
}

func (s *CloudService) skillBundle(ctx context.Context, manifest []SkillSnapshot, files []FileRow) ([]byte, error) {
	if len(manifest) != len(files) || s.Host.Files == nil {
		return nil, integrity()
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for i, skill := range manifest {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		source, err := s.Host.Files.Open(files[i].StorageKey)
		if err != nil {
			return nil, err
		}
		archive, err := io.ReadAll(io.LimitReader(source, skillpackage.MaxArchiveBytes+1))
		_ = source.Close()
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(archive)
		if int64(len(archive)) > skillpackage.MaxArchiveBytes || hex.EncodeToString(digest[:]) != skill.ArchiveSHA {
			return nil, httpx.E(409, "SKILL_INTEGRITY_FAILED", "技能包完整性验证失败")
		}
		if buffer.Len()+len(archive) > 96<<20 {
			return nil, httpx.E(422, "SKILL_SET_TOO_LARGE", "技能包总大小不能超过 96 MiB")
		}
		target, err := writer.CreateHeader(&zip.FileHeader{Name: skill.Name + ".zip", Method: zip.Store})
		if err != nil {
			return nil, err
		}
		if _, err = target.Write(archive); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (s *CloudService) uploadSkillBundle(ctx context.Context, access *SandboxAccess, token string, data []byte) error {
	err := s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
		o.TransferToken, o.TransferState = token, "preparing"
		return nil
	})
	if err != nil {
		return err
	}
	if _, err = s.workspaceHelper(ctx, access, access.HelperOperationID, workspacefs.Request{Operation: "transfer_begin", Token: token}); err != nil {
		return err
	}
	err = s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
		o.TransferState = "started"
		return nil
	})
	if err != nil {
		return err
	}
	uid, gid := uint32(0), uint32(0)
	err = access.Provider.PutFile(ctx, access.Resource, sandboxcore.FileRequest{Path: workspacefs.TransferDirectory + "/" + token + "/payload", UID: &uid, GID: &gid, MaxBytes: int64(len(data))}, bytes.NewReader(data))
	if err != nil {
		return s.workspaceTransferUnknown(ctx, access, access.HelperOperationID)
	}
	return s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
		o.TransferState = "finished"
		return nil
	})
}
