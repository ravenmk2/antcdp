package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) compactionExecution(tx identity.Tx, r Repository, st StateRepository, record agentcore.CompactionRecord) (executionRows, *CompactionRow, error) {
	var x executionRows
	var e error
	if record.Request.Ref != nil {
		x, e = s.lockExecution(tx, r, st, *record.Request.Ref, true)
		if e != nil {
			return x, nil, e
		}
	} else {
		initial, e := st.Session(uint64(record.Request.SessionID), false)
		if e != nil {
			return x, nil, e
		}
		if initial == nil {
			return x, nil, missing()
		}
		if _, e = runtimeOwner(tx, initial); e != nil {
			return x, nil, e
		}
		model, selection, e := s.selection(tx, r, initial)
		if e != nil {
			return x, nil, e
		}
		if !selection.Availability.Available {
			return x, nil, httpx.E(409, "MODEL_UNAVAILABLE", "压缩模型不可用")
		}
		agent, e := r.Definition(initial.AgentID, true)
		if e != nil {
			return x, nil, e
		}
		if agent == nil || !agent.Enabled {
			return x, nil, httpx.E(409, "AGENT_UNAVAILABLE", "智能体不可用")
		}
		v, e := st.Session(initial.ID, true)
		if e != nil {
			return x, nil, e
		}
		if v == nil || v.RowVersion != initial.RowVersion || v.ArchivedAt != nil || v.ActiveRunID != nil {
			return x, nil, httpx.E(409, "COMPACTION_SOURCE_CHANGED", "会话状态已变化")
		}
		x = executionRows{Session: v, RootSession: v, Agent: agent, Execution: agentcore.ExecutionContext{AgentID: agentcore.ID(v.AgentID), ContentSessionID: agentcore.ID(v.ID), Principal: agentcore.PrincipalRef{Kind: "user", ID: agentcore.ID(v.ExecutorUserID)}, Model: model}}
	}
	row, e := st.Compaction(uint64(record.ID), true)
	if e != nil {
		return x, nil, e
	}
	if row == nil || row.SessionID != x.Session.ID || row.Status != "running" || row.ExecutorEpoch != s.Epoch || x.Session.ActiveCompactionID == nil || *x.Session.ActiveCompactionID != row.ID || !time.Now().UTC().Before(row.DeadlineAt) {
		return x, nil, httpx.E(409, "COMPACTION_FENCED", "压缩执行已失效")
	}
	return x, row, nil
}

func (s *Service) Summarize(ctx context.Context, record agentcore.CompactionRecord, request modelcore.Request) (modelcore.Response, error) {
	var response modelcore.Response
	if s.RuntimeModels == nil || s.Tokens == nil {
		return response, unavailable()
	}
	var frozen agentcore.LockedModel
	var callID uint64
	var epoch string
	var fence uint64
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, row, e := s.compactionExecution(tx, r, st, record)
		if e != nil {
			return e
		}
		existing, e := st.CompactionModelCall(row.ID)
		if e != nil {
			return e
		}
		if existing != nil {
			return httpx.E(409, "ATTEMPT_ALREADY_STARTED", "压缩模型请求已登记，不能自动重发")
		}
		frozen = x.Execution.Model
		if request.Model != frozen.RemoteModelID || request.Protocol != frozen.Protocol {
			return integrity()
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		hash, e := agentcore.ContentHash(request)
		if e != nil {
			return e
		}
		digest, e := hex.DecodeString(hash)
		if e != nil {
			return e
		}
		thinking, _ := json.Marshal(map[string]string{"option_key": frozen.ThinkingKey})
		caps, _ := json.Marshal(frozen.Capabilities)
		snapshot, e := snapshotRequest(request, frozen, nil, 1)
		if e != nil {
			return e
		}
		config, e := json.Marshal(snapshot)
		if e != nil {
			return e
		}
		selected := record.Request.Source
		if record.Request.First < 0 || record.Request.Last < record.Request.First || record.Request.Last >= len(selected.Entries) {
			return integrity()
		}
		selected.Entries = selected.Entries[record.Request.First : record.Request.Last+1]
		manifest, e := json.Marshal(selected)
		if e != nil {
			return e
		}
		call := &ModelCallRow{SessionID: row.SessionID, RunID: row.RunID, CompactionID: &row.ID, Purpose: "compaction", Status: "running", ProviderID: uint64(frozen.ProviderID), ModelDefinitionID: uint64(frozen.DefinitionID), Protocol: string(frozen.Protocol), RequestedModelID: frozen.RemoteModelID, Thinking: thinking, RequestConfig: config, SurfaceManifest: manifest, RequestHash: digest, CapabilitySnapshot: caps, ExecutorEpoch: row.ExecutorEpoch, FenceVersion: row.FenceVersion, UsageCompleteness: "unknown", CreatedAt: now, StartedAt: &now, DeadlineAt: row.DeadlineAt}
		if x.Root != nil {
			call.RootRunID = &x.Root.ID
			l, e := ledger(x.Root)
			if e != nil {
				return e
			}
			input, e := s.Tokens.Count(request)
			if e != nil {
				return e
			}
			l, res, e := l.Reserve(agentcore.Budget{ModelCalls: 1, InputTokens: input, OutputTokens: frozen.MaxOutputTokens})
			if e != nil {
				return coreError(e)
			}
			call.BudgetReservation, e = json.Marshal(res)
			if e != nil {
				return e
			}
			if e = saveLedger(st, x.Root, l); e != nil {
				return e
			}
		}
		if e = st.InsertModelCall(call); e != nil {
			return e
		}
		callID = call.ID
		epoch = call.ExecutorEpoch
		fence = call.FenceVersion
		return nil
	})
	if e != nil {
		return response, e
	}
	for i := range request.Messages {
		for j := range request.Messages[i].Images {
			part := &request.Messages[i].Images[j]
			if record.Request.Ref != nil {
				part.DataBase64, e = s.hydrateImage(ctx, *record.Request.Ref, *part)
			} else {
				part.DataBase64, e = s.hydrateCompactionImage(ctx, record, *part)
			}
			if e != nil {
				return response, e
			}
		}
	}
	client, e := s.RuntimeModels.Open(ctx, frozen)
	if e == nil {
		response, e = client.Generate(ctx, request, nil)
	}
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	finishErr := s.background(finish, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, row, err := s.compactionExecution(tx, r, st, record)
		if err != nil {
			return err
		}
		call, err := st.ModelCall(callID, true)
		if err != nil {
			return err
		}
		if call == nil || call.Status != "running" || call.ExecutorEpoch != epoch || call.FenceVersion != fence {
			return httpx.E(409, "COMPACTION_FENCED", "压缩模型结算已失效")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		call.FinishedAt = &now
		call.Status = "completed"
		if e != nil {
			call.Status = "failed"
			reason := "COMPACTION_MODEL_FAILED"
			call.ErrorCode = &reason
		}
		if response.ReturnedModel != "" {
			value := response.ReturnedModel
			call.ResponseModelID = &value
		}
		if x.Root != nil {
			if err = settleModelBudget(st, x.Root, call, response.Usage); err != nil {
				return err
			}
		} else {
			call.UsageRaw, _ = json.Marshal(modelcore.FilterRawUsage(modelcore.Protocol(call.Protocol), response.Usage.RawNumericFields))
			call.InputTokens = usageNumber(response.Usage.InputTokens)
			call.OutputTokens = usageNumber(response.Usage.OutputTokens)
			call.CacheReadTokens = usageNumber(response.Usage.CacheReadTokens)
			call.CacheWriteTokens = usageNumber(response.Usage.CacheWriteTokens)
			if call.InputTokens != nil && call.OutputTokens != nil {
				call.UsageCompleteness = "complete"
			} else if call.InputTokens != nil || call.OutputTokens != nil {
				call.UsageCompleteness = "partial"
			}
			if response.Usage.NormalizationVersion != "" {
				value := response.Usage.NormalizationVersion
				call.UsageSemanticsVersion = &value
			}
		}
		if row.ID != *call.CompactionID {
			return integrity()
		}
		return st.SaveModelCall(call)
	})
	if finishErr != nil {
		return response, finishErr
	}
	return response, e
}

func (s *Service) CommitReplacement(ctx context.Context, result agentcore.CompactionResult) (agentcore.CommitReceipt, error) {
	var out agentcore.CommitReceipt
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, row, e := s.compactionExecution(tx, r, st, result.Record)
		if e != nil {
			return e
		}
		current, facts, e := loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		if _, e = agentcore.BuildSurface(current, facts); e != nil {
			return e
		}
		replacement := result.Replacement
		replacement.SummarySeq = agentcore.Seq(x.Session.LastSeq + 1)
		replacement.Summary = strings.TrimSpace(replacement.Summary)
		if len(replacement.Summary) > 64<<10 {
			return httpx.E(409, "COMPACTION_INVALID_SUMMARY", "摘要超过长度限制")
		}
		next, e := agentcore.ApplyReplacement(current, replacement)
		if e != nil {
			return coreError(e)
		}
		if row.SourceSurfaceRevision != uint64(replacement.SourceRevision) || hexHash(row.SourceHash) != replacement.SourceHash {
			return httpx.E(409, "COMPACTION_SOURCE_CHANGED", "压缩源发生变化")
		}
		call, e := st.CompactionModelCall(row.ID)
		if e != nil {
			return e
		}
		if call == nil || call.Status != "completed" {
			return httpx.E(409, "COMPACTION_MODEL_FAILED", "压缩模型未成功完成")
		}
		from := x.Session.LastSeq + 1
		now := time.Now().UTC().Truncate(time.Millisecond)
		message := modelcore.Message{Role: "user", Content: replacement.Summary}
		seq, e := appendEvent(st, x.Session, row.RunID, "compaction/summary", "", map[string]any{"compaction_id": agentcore.ID(row.ID), "content": []agentcore.ContentBlock{{Type: "text", Text: replacement.Summary}}, "replacement": map[string]any{"from_seq": agentcore.Seq(row.FromSeq), "through_seq": agentcore.Seq(row.ThroughSeq)}}, &StoredEvent{Message: &message, Surface: &next, ModelCallID: agentcore.ID(call.ID)}, now)
		if e != nil {
			return e
		}
		row.SummaryEventSeq = &seq
		call.ResponseEventSeq = &seq
		if e = st.SaveModelCall(call); e != nil {
			return e
		}
		row.Status = "completed"
		row.FinishedAt = &now
		row.FenceVersion++
		end, e := appendEvent(st, x.Session, row.RunID, "compaction/end", "", map[string]any{"compaction_id": agentcore.ID(row.ID), "status": "completed", "summary_seq": agentcore.Seq(seq), "reason_code": nil}, nil, now)
		if e != nil {
			return e
		}
		row.EndEventSeq = &end
		x.Session.ActiveCompactionID = nil
		x.Session.SurfaceRevision = uint64(next.Revision)
		if e = st.SaveCompaction(row); e != nil {
			return e
		}
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		if row.PublicOperationID != nil {
			op, e := st.PublicOperation(*row.PublicOperationID, true)
			if e != nil {
				return e
			}
			if op == nil {
				return integrity()
			}
			op.Status = "succeeded"
			op.FinishedAt = &now
			op.UpdatedAt = now
			op.FenceVersion++
			op.Result, e = json.Marshal(map[string]any{"session_id": agentcore.ID(row.SessionID), "from_seq": agentcore.Seq(row.FromSeq), "through_seq": agentcore.Seq(row.ThroughSeq), "summary_seq": agentcore.Seq(seq), "replacement_seq": agentcore.Seq(seq), "token_estimate_before": strconv.FormatUint(replacement.BeforeTokens, 10), "token_estimate_after": strconv.FormatUint(replacement.AfterTokens, 10)})
			if e != nil {
				return e
			}
			if e = st.SavePublicOperation(op); e != nil {
				return e
			}
		}
		out = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
		return nil
	})
	return out, e
}

func (s *Service) Fail(ctx context.Context, failure agentcore.CompactionFailure) (agentcore.CommitReceipt, error) {
	var out agentcore.CommitReceipt
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		initial, e := st.Compaction(uint64(failure.Record.ID), false)
		if e != nil {
			return e
		}
		if initial == nil {
			return missing()
		}
		initialSession, e := st.Session(initial.SessionID, false)
		if e != nil {
			return e
		}
		if initialSession == nil {
			return integrity()
		}
		if initialSession.RootSessionID != nil {
			if _, e = st.Session(*initialSession.RootSessionID, true); e != nil {
				return e
			}
		}
		v, e := st.Session(initial.SessionID, true)
		if e != nil {
			return e
		}
		if v == nil {
			return integrity()
		}
		var root *RunRow
		if initial.RunID != nil {
			run, e := st.Run(*initial.RunID, false)
			if e != nil {
				return e
			}
			if run == nil {
				return integrity()
			}
			id := run.ID
			if run.RootRunID != nil {
				id = *run.RootRunID
			}
			root, e = st.Run(id, true)
			if e != nil {
				return e
			}
		}
		row, e := st.Compaction(initial.ID, true)
		if e != nil {
			return e
		}
		if row == nil {
			return integrity()
		}
		if row.Status != "queued" && row.Status != "running" {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		from := v.LastSeq + 1
		row.Status = "failed"
		if row.ExecutorEpoch != s.Epoch || !now.Before(row.DeadlineAt) {
			row.Status = "interrupted"
		}
		reason := failure.Reason
		if reason == "" {
			reason = "COMPACTION_FAILED"
		}
		row.ErrorCode = &reason
		row.FinishedAt = &now
		row.FenceVersion++
		call, e := st.CompactionModelCall(row.ID)
		if e != nil {
			return e
		}
		if call != nil && call.Status == "running" {
			call.Status = "interrupted"
			call.ErrorCode = &reason
			call.FinishedAt = &now
			if root != nil {
				if e = settleModelBudget(st, root, call, modelcore.Usage{}); e != nil {
					return e
				}
			}
			if e = st.SaveModelCall(call); e != nil {
				return e
			}
		}
		seq, e := appendEvent(st, v, row.RunID, "compaction/end", "", map[string]any{"compaction_id": agentcore.ID(row.ID), "status": row.Status, "summary_seq": nil, "reason_code": reason}, nil, now)
		if e != nil {
			return e
		}
		row.EndEventSeq = &seq
		if v.ActiveCompactionID != nil && *v.ActiveCompactionID == row.ID {
			v.ActiveCompactionID = nil
		}
		if e = st.SaveCompaction(row); e != nil {
			return e
		}
		if e = st.SaveSession(v); e != nil {
			return e
		}
		if row.PublicOperationID != nil {
			op, e := st.PublicOperation(*row.PublicOperationID, true)
			if e != nil {
				return e
			}
			if op == nil {
				return integrity()
			}
			op.Status = row.Status
			op.ErrorCode = &reason
			op.FinishedAt = &now
			op.UpdatedAt = now
			op.FenceVersion++
			if e = st.SavePublicOperation(op); e != nil {
				return e
			}
		}
		out = eventReceipt(v.ID, from, v.LastSeq)
		return nil
	})
	if e == nil && s.Committed != nil && len(out.Ranges) > 0 {
		s.Committed(ctx, out)
	}
	return out, e
}

var _ agentcore.CompactionStore = (*Service)(nil)
var _ agentcore.SummaryCaller = (*Service)(nil)

func (s *Service) hydrateCompactionImage(ctx context.Context, record agentcore.CompactionRecord, part modelcore.ImagePart) (string, error) {
	if s.Files == nil {
		return "", unavailable()
	}
	hash, e := hex.DecodeString(part.ContentSHA256)
	if e != nil || len(hash) != 32 {
		return "", integrity()
	}
	var file *FileRow
	var lease *ResourceReferenceRow
	e = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, _, e := s.compactionExecution(tx, r, st, record)
		if e != nil {
			return e
		}
		file, e = st.FileByHash(x.RootSession.ID, hash)
		if e != nil {
			return e
		}
		if file == nil || file.MediaType != part.MIME || !isImage(file.MediaType) || file.SizeBytes == nil || *file.SizeBytes > modelcore.MaxImageBytes {
			return httpx.E(409, "FILE_UNAVAILABLE", "图像文件不可用")
		}
		now := time.Now().UTC()
		lease = &ResourceReferenceRow{HolderKind: "download", HolderID: NewStorageKey(), ResourceKind: "file", ResourceID: file.ID, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		return st.InsertResourceReference(lease)
	})
	if e != nil {
		return "", e
	}
	return s.readImageBytes(ctx, file, lease.ID)
}
